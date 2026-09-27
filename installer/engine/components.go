package main

// Tool installations are wholly contained in <selected application>/components.
// The schema is shared with app/updates/components.js; PATH is never consulted.
import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type ComponentPin struct {
	ID        string `json:"id"`
	Version   string `json:"version"`
	Format    string `json:"format"`
	License   string `json:"license"`
	SourceURL string `json:"sourceURL"`
	File      struct {
		URL     string `json:"url"`
		SHA256  string `json:"sha256"`
		Size    int64  `json:"size"`
		MaxSize int64  `json:"maxSize"`
	} `json:"file"`
}
type ComponentVersion struct {
	Active   string `json:"active"`
	Previous string `json:"previous,omitempty"`
}
type ToolReceipt struct {
	Schema        int               `json:"schema"`
	ID            string            `json:"id"`
	Version       string            `json:"version"`
	Hashes        map[string]string `json:"hashes"`
	Source        string            `json:"source"`
	ArchiveSHA256 string            `json:"archiveSha256"`
	License       string            `json:"license"`
	SourceURL     string            `json:"sourceURL"`
}

var componentVersionPattern = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+){1,3}(?:[-_][A-Za-z0-9.-]+)?$`)
var componentHashPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)
var componentBinaries = map[string][]string{"ffmpeg": {"ffmpeg.exe", "ffprobe.exe"}, "ytdlp": {"yt-dlp.exe"}}

func componentURLAllowed(id, raw string) bool {
	u, e := url.Parse(raw)
	if e != nil || u.Scheme != "https" || u.User != nil || u.Fragment != "" || (u.Port() != "" && u.Port() != "443") {
		return false
	}
	if u.Hostname() == "release-assets.githubusercontent.com" || u.Hostname() == "objects.githubusercontent.com" {
		return true
	}
	if id == "ffmpeg" && u.Hostname() == "www.gyan.dev" {
		return strings.HasPrefix(u.Path, "/ffmpeg/builds/packages/")
	}
	if u.Hostname() != "github.com" {
		return false
	}
	prefix := "/yt-dlp/yt-dlp/releases/download/"
	if id == "ffmpeg" {
		prefix = "/GyanD/codexffmpeg/releases/download/"
	}
	return strings.HasPrefix(u.Path, prefix)
}
func validateComponentPin(id string, p ComponentPin) error {
	if _, ok := componentBinaries[id]; !ok || p.ID != id || len(p.Version) > 80 || !componentVersionPattern.MatchString(p.Version) || !componentHashPattern.MatchString(p.File.SHA256) {
		return errors.New("invalid tool pin")
	}
	if id == "ffmpeg" && p.Format != "zip" || id == "ytdlp" && p.Format != "exe" {
		return errors.New("invalid tool format")
	}
	if p.File.Size < 0 || p.File.Size > 512*1024*1024 || p.File.Size == 0 && (p.File.MaxSize < 1 || p.File.MaxSize > 512*1024*1024) {
		return errors.New("invalid tool size")
	}
	expected := "https://github.com/yt-dlp/yt-dlp/releases/download/" + p.Version + "/yt-dlp.exe"
	if id == "ffmpeg" {
		expected = "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-" + p.Version + "-essentials_build.zip"
	}
	if p.File.URL != expected {
		return errors.New("untrusted tool origin")
	}
	return nil
}
func readComponentPins(file string) (map[string]ComponentPin, error) {
	b, e := os.ReadFile(file)
	if e != nil {
		return nil, e
	}
	if len(b) > 32768 {
		return nil, errors.New("oversized pins")
	}
	var pins map[string]ComponentPin
	if e = json.Unmarshal(b, &pins); e != nil {
		return nil, e
	}
	if len(pins) != 2 {
		return nil, errors.New("missing tool pins")
	}
	for _, id := range []string{"ytdlp", "ffmpeg"} {
		if e = validateComponentPin(id, pins[id]); e != nil {
			return nil, e
		}
	}
	return pins, nil
}
func componentDownload(ctx context.Context, p ComponentPin, dest string, notify func(Event)) error {
	urls := []string{p.File.URL}
	if p.ID == "ffmpeg" {
		urls = append(urls, "https://github.com/GyanD/codexffmpeg/releases/download/"+p.Version+"/ffmpeg-"+p.Version+"-essentials_build.zip")
	}
	limit := p.File.Size
	if limit == 0 {
		limit = p.File.MaxSize
	}
	err := fetchVerified(ctx, urls, dest, p.File.SHA256, limit, func(u string) bool { return componentURLAllowed(p.ID, u) }, "components", notify)
	return annotateFailure(err, "component", p.ID)
}
func componentBinary(file string) bool {
	if !noLinks(file) {
		return false
	}
	st, e := os.Lstat(file)
	if e != nil || !st.Mode().IsRegular() || st.Size() < 2 {
		return false
	}
	f, e := os.Open(file)
	if e != nil {
		return false
	}
	defer f.Close()
	b := make([]byte, 2)
	_, e = io.ReadFull(f, b)
	return e == nil && string(b) == "MZ"
}
func validInstalledComponent(root, id, version string) bool {
	if !componentVersionPattern.MatchString(version) || len(version) > 80 {
		return false
	}
	dir := filepath.Join(root, id, version)
	if !noLinks(dir) || !noLinks(filepath.Join(dir, "receipt.json")) {
		return false
	}
	b, e := os.ReadFile(filepath.Join(dir, "receipt.json"))
	if e != nil || len(b) > 32768 {
		return false
	}
	var receipt ToolReceipt
	if json.Unmarshal(b, &receipt) != nil || receipt.Schema != 1 || receipt.ID != id || receipt.Version != version {
		return false
	}
	for _, name := range componentBinaries[id] {
		file := filepath.Join(dir, name)
		if !componentBinary(file) {
			return false
		}
		h, e := fileHash(file)
		if e != nil || !componentHashPattern.MatchString(receipt.Hashes[name]) || h != receipt.Hashes[name] {
			return false
		}
	}
	return true
}
func componentAtLeast(a, b string) bool {
	if !componentVersionPattern.MatchString(a) || !componentVersionPattern.MatchString(b) {
		return false
	}
	x, y := strings.Split(a, "."), strings.Split(b, ".")
	for i := 0; i < len(x) || i < len(y); i++ {
		l, r := 0, 0
		var e error
		if i < len(x) {
			l, e = strconv.Atoi(x[i])
			if e != nil {
				return a == b
			}
		}
		if i < len(y) {
			r, e = strconv.Atoi(y[i])
			if e != nil {
				return a == b
			}
		}
		if l != r {
			return l > r
		}
	}
	return true
}

type boundedProbeOutput struct{ bytes.Buffer }

func (b *boundedProbeOutput) Write(p []byte) (int, error) {
	n := len(p)
	if b.Len() < 16384 {
		keep := 16384 - b.Len()
		if keep > n {
			keep = n
		}
		b.Buffer.Write(p[:keep])
	}
	return n, nil
}
func probeSetupComponent(ctx context.Context, file string) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	arg := "-version"
	if filepath.Base(file) == "yt-dlp.exe" {
		arg = "--version"
	}
	c := exec.CommandContext(ctx, file, arg)
	hideProcess(c)
	c.Dir = filepath.Dir(file)
	out := &boundedProbeOutput{}
	c.Stdout = out
	c.Stderr = out
	if e := c.Run(); e != nil {
		return e
	}
	if out.Len() == 0 {
		return errors.New("empty tool version")
	}
	return nil
}
func extractComponentZip(archive, dest string) error {
	z, e := zip.OpenReader(archive)
	if e != nil {
		return e
	}
	defer z.Close()
	if len(z.File) > 4096 {
		return errors.New("tool archive entry limit")
	}
	seen, found := map[string]bool{}, map[string]bool{}
	var total uint64
	for _, f := range z.File {
		name := strings.TrimSuffix(f.Name, "/")
		key := strings.ToLower(name)
		if !safeRelative(name) || seen[key] || f.Mode()&os.ModeSymlink != 0 || f.Flags&1 != 0 {
			return errors.New("unsafe tool archive")
		}
		seen[key] = true
		total += f.UncompressedSize64
		if total > 1024*1024*1024 || f.UncompressedSize64 > 600*1024*1024 {
			return errors.New("tool archive size limit")
		}
		if f.FileInfo().IsDir() {
			continue
		}
		base := strings.ToLower(filepath.Base(name))
		wanted := base == "ffmpeg.exe" || base == "ffprobe.exe"
		notice := (strings.HasPrefix(base, "license") || strings.HasPrefix(base, "readme") || strings.HasPrefix(base, "copying") || strings.HasPrefix(base, "source")) && (strings.HasSuffix(base, ".txt") || strings.HasSuffix(base, ".md")) && f.UncompressedSize64 < 2*1024*1024
		if !wanted && !notice {
			continue
		}
		if wanted && found[base] {
			return errors.New("duplicate tool binary")
		}
		found[base] = true
		file := filepath.Join(dest, base)
		if notice {
			file = filepath.Join(dest, "notices", base)
			if _, e = os.Stat(file); e == nil {
				continue
			}
		}
		if e = os.MkdirAll(filepath.Dir(file), 0700); e != nil {
			return e
		}
		in, e := f.Open()
		if e != nil {
			return e
		}
		out, e := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0700)
		if e != nil {
			in.Close()
			return e
		}
		n, e := io.Copy(out, io.LimitReader(in, int64(f.UncompressedSize64)+1))
		syncErr := out.Sync()
		out.Close()
		in.Close()
		if e != nil {
			return e
		}
		if syncErr != nil {
			return syncErr
		}
		if uint64(n) != f.UncompressedSize64 {
			return errors.New("tool size mismatch")
		}
	}
	if !found["ffmpeg.exe"] || !found["ffprobe.exe"] {
		return errors.New("missing ffmpeg or ffprobe")
	}
	return nil
}

// Injected I/O makes failure/repair/rollback tests offline and deterministic.
func provisionSetupComponents(ctx context.Context, target string, pins map[string]ComponentPin, download func(context.Context, ComponentPin, string, func(Event)) error, probe func(context.Context, string) error, notify func(Event)) error {
	root := filepath.Join(target, "components")
	indexFile := filepath.Join(root, "index.json")
	if !noLinks(indexFile) || !noLinks(indexFile+".tmp") || !noLinks(filepath.Join(root, "downloads")) {
		return errors.New("unsafe component directory")
	}
	index := map[string]ComponentVersion{}
	if b, e := os.ReadFile(indexFile); e == nil {
		if len(b) > 32768 || json.Unmarshal(b, &index) != nil || index == nil {
			return errors.New("invalid component index")
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if e := os.MkdirAll(filepath.Join(root, "downloads"), 0700); e != nil {
		return e
	}
	for _, id := range []string{"ytdlp", "ffmpeg"} {
		p, ok := pins[id]
		if !ok {
			return errors.New("missing component pin")
		}
		if e := validateComponentPin(id, p); e != nil {
			return e
		}
		if componentAtLeast(index[id].Active, p.Version) && validInstalledComponent(root, id, index[id].Active) {
			continue
		}
		if e := installSetupComponent(ctx, root, p, index, download, probe, notify); e != nil {
			return fmt.Errorf("%s: %w", id, e)
		}
	}
	return nil
}
func installSetupComponent(ctx context.Context, root string, p ComponentPin, index map[string]ComponentVersion, download func(context.Context, ComponentPin, string, func(Event)) error, probe func(context.Context, string) error, notify func(Event)) error {
	dir := filepath.Join(root, p.ID)
	final := filepath.Join(dir, p.Version)
	if !noLinks(final) {
		return errors.New("unsafe component destination")
	}
	if e := os.MkdirAll(dir, 0700); e != nil {
		return e
	}
	stage, e := os.MkdirTemp(dir, ".stage-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(stage)
	archive := filepath.Join(root, "downloads", filepath.Base(stage)+"."+p.Format)
	defer os.Remove(archive)
	progress := func(v Event) {
		v.Phase = "components"
		v.Message = p.ID
		if notify != nil {
			notify(v)
		}
	}
	progress(Event{})
	if e = download(ctx, p, archive, progress); e != nil {
		return e
	}
	// Repeat digest validation even when the injected downloader claims success.
	h, e := fileHash(archive)
	if e != nil || h != p.File.SHA256 {
		return errors.New("SETUP_INTEGRITY component checksum")
	}
	if p.File.Size > 0 {
		if st, e := os.Stat(archive); e != nil || st.Size() != p.File.Size {
			return errors.New("component size mismatch")
		}
	}
	if p.Format == "zip" {
		e = extractComponentZip(archive, stage)
	} else {
		e = copyFile(archive, filepath.Join(stage, "yt-dlp.exe"), 0700)
	}
	if e != nil {
		return e
	}
	hashes := map[string]string{}
	for _, name := range componentBinaries[p.ID] {
		file := filepath.Join(stage, name)
		if !componentBinary(file) {
			return errors.New("invalid tool binary")
		}
		if e = probe(ctx, file); e != nil {
			return e
		}
		hashes[name], e = fileHash(file)
		if e != nil {
			return e
		}
	}
	receipt := ToolReceipt{Schema: 1, ID: p.ID, Version: p.Version, Hashes: hashes, Source: p.File.URL, ArchiveSHA256: p.File.SHA256, License: p.License, SourceURL: p.SourceURL}
	if e = atomicJSON(filepath.Join(stage, "receipt.json"), receipt); e != nil {
		return e
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	damaged := ""
	if _, e = os.Lstat(final); e == nil {
		b, _ := os.ReadFile(filepath.Join(final, "receipt.json"))
		var old ToolReceipt
		_ = json.Unmarshal(b, &old)
		if old.ArchiveSHA256 != "" && old.ArchiveSHA256 != p.File.SHA256 {
			return errors.New("component version conflict")
		}
		damaged = final + ".damaged-" + filepath.Base(stage)
		if e = os.Rename(final, damaged); e != nil {
			return e
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	if e = os.Rename(stage, final); e != nil {
		if damaged != "" {
			_ = os.Rename(damaged, final)
		}
		return e
	}
	old := index[p.ID]
	previous := old.Active
	if previous == p.Version {
		previous = old.Previous
	}
	index[p.ID] = ComponentVersion{Active: p.Version, Previous: previous}
	if e = atomicJSON(filepath.Join(root, "index.json"), index); e != nil {
		index[p.ID] = old
		_ = os.RemoveAll(final)
		if damaged != "" {
			_ = os.Rename(damaged, final)
		}
		return e
	}
	if damaged != "" {
		_ = os.RemoveAll(damaged)
	}
	progress(Event{Percent: 100})
	return nil
}
