package main

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func runtimeURLAllowed(raw string) bool {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.User != nil || u.Port() != "" && u.Port() != "443" {
		return false
	}
	if u.Hostname() == "github.com" {
		return strings.HasPrefix(u.Path, "/electron/electron/releases/download/")
	}
	return u.Hostname() == "release-assets.githubusercontent.com" || u.Hostname() == "objects.githubusercontent.com"
}
func fetchRuntime(ctx context.Context, urls []string, dest, sha string, notify func(Event)) error {
	return fetchVerified(ctx, urls, dest, sha, 600*1024*1024, runtimeURLAllowed, "runtime", notify)
}

// Downloads are bounded and hashed while streaming; no unverified binary is run.
func fetchVerified(ctx context.Context, urls []string, dest, sha string, limit int64, allowed func(string) bool, phase string, notify func(Event)) error {
	if !noLinks(filepath.Dir(dest)) {
		return errors.New("SETUP_PATH")
	}
	client := &http.Client{Timeout: 30 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 5 {
			return setupFail("SetupErrorRedirect", errors.New("too many redirects"), nil)
		}
		if !allowed(req.URL.String()) {
			return setupFail("SetupErrorSourceUntrusted", errors.New("untrusted redirect"), map[string]string{"host": safeHost(req.URL.String())})
		}
		return nil
	}}
	var last error = setupFail("SetupErrorSourceMissing", errors.New("download source missing"), nil)
	for _, address := range urls {
		if !allowed(address) {
			return setupFail("SetupErrorSourceUntrusted", errors.New("untrusted download source"), map[string]string{"host": safeHost(address)})
		}
		req, e := http.NewRequestWithContext(ctx, "GET", address, nil)
		if e != nil {
			return e
		}
		req.Header.Set("User-Agent", "PulseDeck Setup")
		res, e := client.Do(req)
		if e != nil {
			last = networkFailure(e)
			continue
		}
		if res.StatusCode != http.StatusOK {
			res.Body.Close()
			last = httpFailure(res.StatusCode, address)
			continue
		}
		if res.ContentLength > limit {
			res.Body.Close()
			return setupFail("SetupErrorSourceTooLarge", errors.New("download exceeds safety limit"), map[string]string{"host": safeHost(address)})
		}
		tmp := dest + fmt.Sprintf(".part-%d", os.Getpid())
		f, e := os.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			res.Body.Close()
			return e
		}
		watchdog := time.AfterFunc(45*time.Second, func() { res.Body.Close() })
		hash := sha256.New()
		var done int64
		buf := make([]byte, 256*1024)
		for {
			n, err := res.Body.Read(buf)
			if n > 0 {
				watchdog.Reset(45 * time.Second)
				done += int64(n)
				if done > limit {
					e = errors.New("runtime archive exceeds limit")
					break
				}
				if _, e = f.Write(buf[:n]); e != nil {
					break
				}
				hash.Write(buf[:n])
				pct := float64(0)
				if res.ContentLength > 0 {
					pct = float64(done) / float64(res.ContentLength) * 100
				}
				if notify != nil {
					notify(Event{Phase: phase, Percent: pct})
				}
			}
			if err == io.EOF {
				break
			}
			if err != nil {
				e = networkFailure(err)
				break
			}
		}
		watchdog.Stop()
		res.Body.Close()
		if e == nil && hex.EncodeToString(hash.Sum(nil)) != sha {
			e = errors.New("SETUP_INTEGRITY")
		}
		if e == nil {
			e = f.Sync()
		}
		f.Close()
		if e != nil {
			os.Remove(tmp)
			last = e
			if ctx.Err() != nil {
				return ctx.Err()
			}
			continue
		}
		if e = replaceAtomic(tmp, dest); e != nil {
			os.Remove(tmp)
			return e
		}
		return nil
	}
	return last
}
func ensureRuntime(ctx context.Context, p *Package, notify func(Event)) (string, error) {
	cache := filepath.Join(localProfile(), "setup-cache", p.Manifest.Runtime.Version)
	if e := os.MkdirAll(cache, 0700); e != nil {
		return "", e
	}
	archive := filepath.Join(cache, "electron.zip")
	if actual, e := fileHash(archive); e == nil && actual == p.Manifest.Runtime.SHA256 {
		return archive, nil
	}
	if f, ok := p.Files["runtime/electron.zip"]; ok {
		b, e := zipBytes(f, 600*1024*1024)
		if e != nil {
			return "", e
		}
		h := sha256.Sum256(b)
		if hex.EncodeToString(h[:]) != p.Manifest.Runtime.SHA256 {
			return "", errors.New("SETUP_INTEGRITY")
		}
		if e = os.WriteFile(archive, b, 0600); e != nil {
			return "", e
		}
		return archive, nil
	}
	if e := fetchRuntime(ctx, p.Manifest.Runtime.URLs, archive, p.Manifest.Runtime.SHA256, notify); e != nil {
		return "", e
	}
	return archive, nil
}
func extractRuntime(archive, dest string) error {
	z, e := zip.OpenReader(archive)
	if e != nil {
		return e
	}
	defer z.Close()
	if len(z.File) > 4096 {
		return errors.New("too many runtime files")
	}
	var total uint64
	seen := map[string]bool{}
	for _, f := range z.File {
		name := strings.TrimSuffix(f.Name, "/")
		if !safeRelative(name) || seen[strings.ToLower(name)] || f.Mode()&os.ModeSymlink != 0 {
			return errors.New("unsafe runtime path")
		}
		seen[strings.ToLower(name)] = true
		total += f.UncompressedSize64
		if total > 1500*1024*1024 || f.UncompressedSize64 > 700*1024*1024 {
			return errors.New("runtime extraction limit")
		}
		target := filepath.Join(dest, filepath.FromSlash(name))
		if f.FileInfo().IsDir() {
			if e = os.MkdirAll(target, 0700); e != nil {
				return e
			}
			continue
		}
		if e = os.MkdirAll(filepath.Dir(target), 0700); e != nil {
			return e
		}
		in, e := f.Open()
		if e != nil {
			return e
		}
		out, e := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			in.Close()
			return e
		}
		n, e := io.Copy(out, io.LimitReader(in, int64(f.UncompressedSize64)+1))
		out.Close()
		in.Close()
		if e != nil {
			return e
		}
		if uint64(n) != f.UncompressedSize64 {
			return errors.New("runtime size mismatch")
		}
	}
	if _, e = os.Stat(filepath.Join(dest, "electron.exe")); e != nil {
		return errors.New("runtime executable missing")
	}
	return nil
}
