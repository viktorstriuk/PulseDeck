package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func componentFixture(t *testing.T) (map[string]ComponentPin, map[string][]byte) {
	t.Helper()
	z := archive(t, map[string]string{"ffmpeg/bin/ffmpeg.exe": "MZ ffmpeg fixture", "ffmpeg/bin/ffprobe.exe": "MZ ffprobe fixture", "ffmpeg/LICENSE.txt": "license fixture", "ffmpeg/bin/ffplay.exe": "MZ not installed"})
	b, e := os.ReadFile(z)
	if e != nil {
		t.Fatal(e)
	}
	data := map[string][]byte{"ytdlp": []byte("MZ yt-dlp fixture"), "ffmpeg": b}
	pins := map[string]ComponentPin{}
	for _, id := range []string{"ytdlp", "ffmpeg"} {
		p := ComponentPin{ID: id, Version: "2026.08.19", Format: "exe", License: "test fixture"}
		p.File.URL = "https://github.com/yt-dlp/yt-dlp/releases/download/" + p.Version + "/yt-dlp.exe"
		if id == "ffmpeg" {
			p.Version = "9.0.2"
			p.Format = "zip"
			p.File.URL = "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip"
		}
		h := sha256.Sum256(data[id])
		p.File.SHA256 = hex.EncodeToString(h[:])
		p.File.Size = int64(len(data[id]))
		pins[id] = p
	}
	return pins, data
}
func fixtureProvisioner(t *testing.T) func(context.Context, string, map[string]ComponentPin, func(Event)) error {
	pins, data := componentFixture(t)
	return func(ctx context.Context, target string, _ map[string]ComponentPin, notify func(Event)) error {
		return provisionSetupComponents(ctx, target, pins, func(_ context.Context, p ComponentPin, dest string, n func(Event)) error {
			rel, e := filepath.Rel(target, dest)
			if e != nil || strings.HasPrefix(rel, "..") {
				t.Fatal("download outside application", dest)
			}
			return os.WriteFile(dest, data[p.ID], 0600)
		}, func(_ context.Context, file string) error {
			if !componentBinary(file) {
				return errors.New("invalid fixture binary")
			}
			return nil
		}, notify)
	}
}
func TestComponentsProvisionInsideChosenFolderAndRetryOffline(t *testing.T) {
	target := filepath.Join(t.TempDir(), "PulseDeck")
	provision := fixtureProvisioner(t)
	var events []Event
	if e := provision(context.Background(), target, nil, func(v Event) { events = append(events, v) }); e != nil {
		t.Fatal(e)
	}
	for id, version := range map[string]string{"ytdlp": "2026.08.19", "ffmpeg": "9.0.2"} {
		if !validInstalledComponent(filepath.Join(target, "components"), id, version) {
			t.Fatal("not installed", id)
		}
	}
	if len(events) < 2 {
		t.Fatal("missing progress")
	}
	for _, v := range events {
		if v.Phase != "components" {
			t.Fatal(v)
		}
	}
	pins, _ := componentFixture(t)
	calls := 0
	if e := provisionSetupComponents(context.Background(), target, pins, func(context.Context, ComponentPin, string, func(Event)) error { calls++; return errors.New("offline") }, nil, nil); e != nil || calls != 0 {
		t.Fatal("valid installed tools downloaded twice", e, calls)
	}
	if _, e := os.Stat(filepath.Join(target, "components/ffmpeg/9.0.2/ffplay.exe")); !os.IsNotExist(e) {
		t.Fatal("unwanted executable")
	}
}
func TestComponentsRepairMissingFFprobeSameVersion(t *testing.T) {
	target := t.TempDir()
	provision := fixtureProvisioner(t)
	if e := provision(context.Background(), target, nil, nil); e != nil {
		t.Fatal(e)
	}
	root := filepath.Join(target, "components")
	_ = os.Remove(filepath.Join(root, "ffmpeg/9.0.2/ffprobe.exe"))
	if validInstalledComponent(root, "ffmpeg", "9.0.2") {
		t.Fatal("partial pair accepted")
	}
	if e := provision(context.Background(), target, nil, nil); e != nil {
		t.Fatal(e)
	}
	if !validInstalledComponent(root, "ffmpeg", "9.0.2") {
		t.Fatal("not repaired")
	}
}
func TestComponentsBadDigestNeverProbedOrPublished(t *testing.T) {
	pins, _ := componentFixture(t)
	target := t.TempDir()
	probes := 0
	e := provisionSetupComponents(context.Background(), target, pins, func(_ context.Context, _ ComponentPin, dest string, _ func(Event)) error {
		return os.WriteFile(dest, []byte("MZ corrupted"), 0600)
	}, func(context.Context, string) error { probes++; return nil }, nil)
	if e == nil || probes != 0 {
		t.Fatal("unverified binary executed", e, probes)
	}
	if _, e = os.Stat(filepath.Join(target, "components/index.json")); !os.IsNotExist(e) {
		t.Fatal("published bad tools")
	}
}
func TestComponentsProbeFailureNoIndex(t *testing.T) {
	pins, data := componentFixture(t)
	target := t.TempDir()
	e := provisionSetupComponents(context.Background(), target, pins, func(_ context.Context, p ComponentPin, dest string, _ func(Event)) error {
		return os.WriteFile(dest, data[p.ID], 0600)
	}, func(context.Context, string) error { return errors.New("cannot run") }, nil)
	if e == nil {
		t.Fatal("bad probe accepted")
	}
	if _, e = os.Stat(filepath.Join(target, "components/index.json")); !os.IsNotExist(e) {
		t.Fatal("published failed binary")
	}
}
func TestComponentsCancelNoPublish(t *testing.T) {
	pins, data := componentFixture(t)
	target := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	e := provisionSetupComponents(ctx, target, pins, func(_ context.Context, p ComponentPin, dest string, _ func(Event)) error {
		return os.WriteFile(dest, data[p.ID], 0600)
	}, func(context.Context, string) error { cancel(); return nil }, nil)
	if e == nil {
		t.Fatal("cancelled update published")
	}
}
func TestComponentsIgnoreExternalTools(t *testing.T) {
	target := t.TempDir()
	external := t.TempDir()
	put(t, filepath.Join(external, "yt-dlp.exe"), "MZ external")
	t.Setenv("PATH", external)
	pins, _ := componentFixture(t)
	calls := 0
	e := provisionSetupComponents(context.Background(), target, pins, func(context.Context, ComponentPin, string, func(Event)) error { calls++; return errors.New("offline") }, nil, nil)
	if e == nil || calls != 1 {
		t.Fatal("external tool used", e, calls)
	}
}
func TestComponentsRejectSymlinkDirectory(t *testing.T) {
	target := t.TempDir()
	outside := t.TempDir()
	if e := os.Symlink(outside, filepath.Join(target, "components")); e != nil {
		t.Skip(e)
	}
	if e := fixtureProvisioner(t)(context.Background(), target, nil, nil); e == nil {
		t.Fatal("symlink accepted")
	}
	files, _ := os.ReadDir(outside)
	if len(files) != 0 {
		t.Fatal("wrote outside application")
	}
}
func TestComponentsCorruptIndexNotDiscarded(t *testing.T) {
	target := t.TempDir()
	file := filepath.Join(target, "components/index.json")
	put(t, file, "bad index")
	if e := fixtureProvisioner(t)(context.Background(), target, nil, nil); e == nil {
		t.Fatal("corrupt index ignored")
	}
	if contents(t, file) != "bad index" {
		t.Fatal("index replaced")
	}
}
func TestComponentsReadBundledPins(t *testing.T) {
	pins, e := readComponentPins("../../app/updates/pins.json")
	if e != nil || len(pins) != 2 {
		t.Fatal(e)
	}
}
func TestComponentsRejectInvalidPins(t *testing.T) {
	pins, _ := componentFixture(t)
	for _, patch := range []func(*ComponentPin){func(p *ComponentPin) { p.Version = "../../outside" }, func(p *ComponentPin) { p.ID = "other" }, func(p *ComponentPin) { p.File.URL = "https://evil.test/yt-dlp.exe" }, func(p *ComponentPin) { p.File.SHA256 = "bad" }, func(p *ComponentPin) { p.File.Size = 1 << 40 }, func(p *ComponentPin) { p.Format = "zip" }} {
		p := pins["ytdlp"]
		patch(&p)
		if validateComponentPin("ytdlp", p) == nil {
			t.Fatal("unsafe pin accepted", p)
		}
	}
}
func TestComponentURLAllowlist(t *testing.T) {
	for _, u := range []string{"http://github.com/yt-dlp/yt-dlp/releases/download/v/a", "https://github.com.evil.test/yt-dlp/yt-dlp/releases/download/a", "https://user:pw@github.com/yt-dlp/yt-dlp/releases/download/a", "https://github.com/other/repo/releases/download/a", "file:///C:/foo"} {
		if componentURLAllowed("ytdlp", u) {
			t.Fatal(u)
		}
	}
	if !componentURLAllowed("ffmpeg", "https://www.gyan.dev/ffmpeg/builds/packages/file.zip") {
		t.Fatal("valid publisher blocked")
	}
}
func TestComponentsArchiveValidation(t *testing.T) {
	for name, files := range map[string]map[string]string{"missing": {"a/ffmpeg.exe": "MZ"}, "traversal": {"../ffmpeg.exe": "MZ", "ffprobe.exe": "MZ"}, "duplicate": {"a/ffmpeg.exe": "MZ", "b/ffmpeg.exe": "MZ", "ffprobe.exe": "MZ"}} {
		t.Run(name, func(t *testing.T) {
			if e := extractComponentZip(archive(t, files), t.TempDir()); e == nil {
				t.Fatal("unsafe ZIP accepted")
			}
		})
	}
}
func TestComponentsCurrentNewerNotDowngraded(t *testing.T) {
	target := t.TempDir()
	if e := fixtureProvisioner(t)(context.Background(), target, nil, nil); e != nil {
		t.Fatal(e)
	}
	pins, _ := componentFixture(t)
	p := pins["ytdlp"]
	p.Version = "2026.07.04"
	p.File.URL = "https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp.exe"
	pins["ytdlp"] = p
	if e := provisionSetupComponents(context.Background(), target, pins, func(context.Context, ComponentPin, string, func(Event)) error { return errors.New("must not download") }, nil, nil); e != nil {
		t.Fatal(e)
	}
}
func TestComponentsDownloadFailureKeepsApplication(t *testing.T) {
	root, _ := layout(t)
	p, e := loadPackage()
	if e != nil {
		t.Fatal(e)
	}
	z := archive(t, map[string]string{"electron.exe": "MZ new runtime"})
	p.Manifest.Runtime.SHA256, _ = fileHash(z)
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())
	e = installWithComponents(p, z, root, nil, func(context.Context, string, map[string]ComponentPin, func(Event)) error {
		return errors.New("network unavailable fixture")
	})
	if e == nil || errorCode(e) != "SetupErrorComponents" {
		t.Fatal(e)
	}
	if contents(t, filepath.Join(root, "PulseDeck.exe")) != "old exe" {
		t.Fatal("replaced working installation")
	}
}
func TestComponentReceiptMatchesJavaScriptSchema(t *testing.T) {
	target := t.TempDir()
	if e := fixtureProvisioner(t)(context.Background(), target, nil, nil); e != nil {
		t.Fatal(e)
	}
	b, e := os.ReadFile(filepath.Join(target, "components/ytdlp/2026.08.19/receipt.json"))
	if e != nil {
		t.Fatal(e)
	}
	var r map[string]interface{}
	_ = json.Unmarshal(b, &r)
	for _, k := range []string{"schema", "id", "version", "hashes", "source", "archiveSha256", "license", "sourceURL"} {
		if _, ok := r[k]; !ok {
			t.Fatal("missing receipt field", k)
		}
	}
}
