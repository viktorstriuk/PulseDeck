package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func put(t *testing.T, file, text string) {
	t.Helper()
	if e := os.MkdirAll(filepath.Dir(file), 0700); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(file, []byte(text), 0600); e != nil {
		t.Fatal(e)
	}
}
func contents(t *testing.T, file string) string {
	t.Helper()
	b, e := os.ReadFile(file)
	if e != nil {
		t.Fatal(e)
	}
	return string(b)
}
func layout(t *testing.T) (string, string) {
	t.Helper()
	root := filepath.Join(t.TempDir(), "PulseDeck")
	stage := filepath.Join(root, ".pulsedeck-stage-test")
	put(t, filepath.Join(root, "PulseDeck.exe"), "old exe")
	put(t, filepath.Join(root, "resources/app/package.json"), `{"name":"pulsedeck","version":"2.7.1"}`)
	put(t, filepath.Join(root, "resources/app/renderer.js"), "old renderer")
	put(t, filepath.Join(root, "music/song.wav"), "MY MUSIC")
	put(t, filepath.Join(root, "music/.pulsedeck-vault/secret.pda"), "ENCRYPTED")
	put(t, filepath.Join(root, "data/lyrics/a.json"), "MY LYRICS")
	put(t, filepath.Join(root, "personal.txt"), "DO NOT TOUCH")
	put(t, filepath.Join(stage, "PulseDeck.exe"), "new exe")
	put(t, filepath.Join(stage, "resources/app/package.json"), `{"name":"pulsedeck","version":"2.8.0"}`)
	put(t, filepath.Join(stage, "resources/app/renderer.js"), "new renderer")
	put(t, filepath.Join(stage, "LICENSE"), "runtime license")
	return root, stage
}
func userData(t *testing.T, root string) {
	t.Helper()
	for name, value := range map[string]string{"music/song.wav": "MY MUSIC", "music/.pulsedeck-vault/secret.pda": "ENCRYPTED", "data/lyrics/a.json": "MY LYRICS", "personal.txt": "DO NOT TOUCH"} {
		if contents(t, filepath.Join(root, name)) != value {
			t.Fatal("user data changed", name)
		}
	}
}
func TestSuccessfulTransactionPreservesAllUserData(t *testing.T) {
	root, stage := layout(t)
	if e := commitStage(root, stage, "2.8.0", nil, nil); e != nil {
		t.Fatal(e)
	}
	if contents(t, filepath.Join(root, "PulseDeck.exe")) != "new exe" {
		t.Fatal("new exe missing")
	}
	userData(t, root)
	var r Receipt
	json.Unmarshal([]byte(contents(t, filepath.Join(root, ".pulsedeck-install.json"))), &r)
	if r.Version != "2.8.0" || r.Previous == "" {
		t.Fatal(r)
	}
	if contents(t, filepath.Join(root, r.Previous, "PulseDeck.exe")) != "old exe" {
		t.Fatal("backup missing")
	}
}
func TestFaultAtEachCommitBoundaryRestoresPriorVersion(t *testing.T) {
	for _, index := range []int{0, 1, 2} {
		t.Run(string(rune('A'+index)), func(t *testing.T) {
			root, stage := layout(t)
			e := commitStage(root, stage, "2.8.0", nil, func(i int) error {
				if i == index {
					return errors.New("injected disk failure")
				}
				return nil
			})
			if e == nil {
				t.Fatal("failure not injected")
			}
			if contents(t, filepath.Join(root, "PulseDeck.exe")) != "old exe" || contents(t, filepath.Join(root, "resources/app/renderer.js")) != "old renderer" {
				t.Fatal("not restored")
			}
			userData(t, root)
			if _, e := os.Stat(filepath.Join(root, "LICENSE")); !os.IsNotExist(e) {
				t.Fatal("new file remains")
			}
			if e = recoverTransaction(root, nil); e != nil {
				t.Fatal("recovery not idempotent", e)
			}
		})
	}
}
func TestPriorReceiptRestoredOnFailedUpdate(t *testing.T) {
	root, stage := layout(t)
	old := Receipt{Schema: 1, Product: "com.pulsedeck.music", Version: "2.7.1", Owned: []string{"PulseDeck.exe", "resources/app"}}
	if e := atomicJSON(filepath.Join(root, ".pulsedeck-install.json"), old); e != nil {
		t.Fatal(e)
	}
	commitStage(root, stage, "2.8.0", nil, func(i int) error { return errors.New("stop") })
	var r Receipt
	json.Unmarshal([]byte(contents(t, filepath.Join(root, ".pulsedeck-install.json"))), &r)
	if r.Version != "2.7.1" {
		t.Fatal("receipt lost", r)
	}
}
func TestPowerLossBetweenRenameAndJournalFlushRecovers(t *testing.T) {
	root, stage := layout(t)
	j := Journal{Schema: 1, Backup: ".pulsedeck-rollback-power", Stage: filepath.Base(stage), Operations: []Operation{{Name: "PulseDeck.exe", HadOld: true, Intent: true}, {Name: "LICENSE", HadOld: false, Intent: true}}}
	if e := atomicJSON(filepath.Join(root, ".pulsedeck-journal.json"), j); e != nil {
		t.Fatal(e)
	}
	os.MkdirAll(filepath.Join(root, j.Backup), 0700)
	os.Rename(filepath.Join(root, "PulseDeck.exe"), filepath.Join(root, j.Backup, "PulseDeck.exe"))
	os.Rename(filepath.Join(stage, "PulseDeck.exe"), filepath.Join(root, "PulseDeck.exe"))
	put(t, filepath.Join(root, "LICENSE"), "new license")
	if e := recoverTransaction(root, nil); e != nil {
		t.Fatal(e)
	}
	if contents(t, filepath.Join(root, "PulseDeck.exe")) != "old exe" {
		t.Fatal("failed recovery")
	}
	userData(t, root)
}
func TestCommittedJournalDoesNotRollbackSuccessfulUpdate(t *testing.T) {
	root, stage := layout(t)
	j := Journal{Schema: 1, Backup: ".pulsedeck-rollback-power", Stage: filepath.Base(stage), Committed: true}
	atomicJSON(filepath.Join(root, ".pulsedeck-journal.json"), j)
	put(t, filepath.Join(root, "PulseDeck.exe"), "new exe")
	if e := recoverTransaction(root, nil); e != nil {
		t.Fatal(e)
	}
	if contents(t, filepath.Join(root, "PulseDeck.exe")) != "new exe" {
		t.Fatal("unexpected rollback")
	}
}
func TestOwnershipWhitelistNeverAcquiresUserRoots(t *testing.T) {
	for _, n := range []string{"music", "data", "tools", "backups", "Pictures", "userDocument.txt", "../PulseDeck.exe", "resources", "resources/app/../../music", ".secret"} {
		if ownedName(n) {
			t.Fatal("unsafe ownership", n)
		}
	}
	for _, n := range []string{"PulseDeck.exe", "resources/app", "locales", "LICENSES.chromium.html", "dxcompiler.dll"} {
		if !ownedName(n) {
			t.Fatal("missing runtime ownership", n)
		}
	}
}
func TestUninstallOnlyRemovesProgramReceipt(t *testing.T) {
	root, stage := layout(t)
	if e := commitStage(root, stage, "2.8.0", nil, nil); e != nil {
		t.Fatal(e)
	}
	if e := uninstall(root, nil); e != nil {
		t.Fatal(e)
	}
	userData(t, root)
	if _, e := os.Stat(filepath.Join(root, "PulseDeck.exe")); !os.IsNotExist(e) {
		t.Fatal("program remains")
	}
}
func TestForgedOwnershipCannotUninstallMusic(t *testing.T) {
	root, _ := layout(t)
	atomicJSON(filepath.Join(root, ".pulsedeck-install.json"), Receipt{Schema: 1, Product: "com.pulsedeck.music", Owned: []string{"music"}})
	if e := uninstall(root, nil); e == nil {
		t.Fatal("unsafe uninstall allowed")
	}
	userData(t, root)
}
func TestCustomCatalogsBackedUpAndCopiedWithoutOverwritingEdits(t *testing.T) {
	root, _ := layout(t)
	profile := filepath.Join(t.TempDir(), "profile")
	put(t, filepath.Join(root, "resources/app/languages/ru.json"), "original RU")
	put(t, filepath.Join(root, "resources/app/languages/de.json"), "USER DE")
	put(t, filepath.Join(root, "resources/app/languages/icons/de.svg"), "USER SVG")
	put(t, filepath.Join(profile, "languages/ru.json"), "OVERRIDE")
	if e := preserveProfile(root, profile); e != nil {
		t.Fatal(e)
	}
	if contents(t, filepath.Join(profile, "languages/ru.json")) != "OVERRIDE" {
		t.Fatal("override overwritten")
	}
	if contents(t, filepath.Join(profile, "languages/de.json")) != "USER DE" {
		t.Fatal("pack lost")
	}
	backups, _ := os.ReadDir(filepath.Join(profile, "backups"))
	if len(backups) != 1 {
		t.Fatal("no original backup")
	}
	if e := preserveProfile(root, profile); e != nil {
		t.Fatal("not idempotent", e)
	}
}
func TestLegacyStoragePathPreservedBeforeReplacement(t *testing.T) {
	root, _ := layout(t)
	profile := t.TempDir()
	t.Setenv("APPDATA", profile)
	t.Setenv("LOCALAPPDATA", t.TempDir())
	t.Setenv("USERPROFILE", t.TempDir())
	put(t, filepath.Join(profile, "PulseDeck/settings.json"), `{"language":"ru","volume":0.34}`)
	if e := preserveLegacyLocations(root); e != nil {
		t.Fatal(e)
	}
	var saved map[string]interface{}
	json.Unmarshal([]byte(contents(t, filepath.Join(profile, "PulseDeck/storage.json"))), &saved)
	if saved["music"] != filepath.Join(root, "music") || saved["data"] != filepath.Join(root, "data") {
		t.Fatal(saved)
	}
	if contents(t, filepath.Join(profile, "PulseDeck/backups/before-storage-v1.json")) != `{"language":"ru","volume":0.34}` {
		t.Fatal("settings backup mismatch")
	}
}
func TestPathValidationRejectsCwdRootUnrelatedAndSymlinks(t *testing.T) {
	dir := t.TempDir()
	put(t, filepath.Join(dir, "important.txt"), "x")
	for _, p := range []string{"", "relative", string(os.PathSeparator), dir} {
		if _, e := validateTarget(p); e == nil {
			t.Fatal("bad path accepted", p)
		}
	}
	outside := t.TempDir()
	link := filepath.Join(t.TempDir(), "linked")
	if e := os.Symlink(outside, link); e == nil {
		if _, e = validateTarget(link); e == nil {
			t.Fatal("symlink accepted")
		}
	}
}
func TestResourceJunctionIsRejectedBeforeAnyMove(t *testing.T) {
	root := filepath.Join(t.TempDir(), "PulseDeck")
	outside := t.TempDir()
	os.MkdirAll(root, 0700)
	put(t, filepath.Join(outside, "app/package.json"), `{"name":"pulsedeck"}`)
	if e := os.Symlink(outside, filepath.Join(root, "resources")); e != nil {
		t.Skip(e)
	}
	stage := filepath.Join(root, ".pulsedeck-stage-new")
	put(t, filepath.Join(stage, "resources/app/renderer.js"), "new")
	if e := commitStage(root, stage, "2.8.0", nil, nil); e == nil {
		t.Fatal("junction accepted")
	}
	if contents(t, filepath.Join(outside, "app/package.json")) != `{"name":"pulsedeck"}` {
		t.Fatal("outside modified")
	}
}
func TestBadJournalCannotAcquireMusicOrForeignBackup(t *testing.T) {
	root, _ := layout(t)
	for _, j := range []Journal{{Schema: 1, Backup: "../outside", Stage: ".pulsedeck-stage-x"}, {Schema: 1, Backup: ".pulsedeck-rollback-x", Stage: ".pulsedeck-stage-x", Operations: []Operation{{Name: "music", Intent: true}}}} {
		atomicJSON(filepath.Join(root, ".pulsedeck-journal.json"), j)
		if e := recoverTransaction(root, nil); e == nil {
			t.Fatal("bad journal accepted")
		}
		userData(t, root)
	}
}
func archive(t *testing.T, files map[string]string) string {
	t.Helper()
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	for n, v := range files {
		f, e := z.Create(n)
		if e != nil {
			t.Fatal(e)
		}
		f.Write([]byte(v))
	}
	z.Close()
	p := filepath.Join(t.TempDir(), "archive.zip")
	os.WriteFile(p, b.Bytes(), 0600)
	return p
}
func TestRuntimeExtractRetainsNoticesAndRequiresElectron(t *testing.T) {
	z := archive(t, map[string]string{"electron.exe": "MZ", "LICENSE": "MIT", "LICENSES.chromium.html": "notices", "locales/en-US.pak": "loc"})
	dest := t.TempDir()
	if e := extractRuntime(z, dest); e != nil {
		t.Fatal(e)
	}
	if contents(t, filepath.Join(dest, "LICENSE")) != "MIT" {
		t.Fatal("notice missing")
	}
	bad := archive(t, map[string]string{"LICENSE": "MIT"})
	if e := extractRuntime(bad, t.TempDir()); e == nil {
		t.Fatal("runtime accepted without exe")
	}
}
func TestRuntimeZipTraversalRejected(t *testing.T) {
	for _, name := range []string{"../escape", "/absolute", "C:/bad", "folder/../../bad", "folder\\bad"} {
		t.Run(name, func(t *testing.T) {
			z := archive(t, map[string]string{"electron.exe": "MZ", name: "x"})
			if e := extractRuntime(z, t.TempDir()); e == nil {
				t.Fatal("unsafe zip accepted", name)
			}
		})
	}
}
func TestRuntimeURLRestrictsExecutableSources(t *testing.T) {
	for _, u := range []string{"http://github.com/electron/electron/releases/download/v1/e.zip", "https://github.com.evil/electron/electron/releases/download/v1/e.zip", "https://github.com/other/repo/releases/download/x", "https://a:b@github.com/electron/electron/releases/download/v1/x"} {
		if runtimeURLAllowed(u) {
			t.Fatal("untrusted", u)
		}
	}
	if !runtimeURLAllowed("https://github.com/electron/electron/releases/download/v44.4.1/e.zip") {
		t.Fatal("official source rejected")
	}
}
func TestPayloadEmbeddedFilesAllPassManifest(t *testing.T) {
	p, e := loadPackage()
	if e != nil {
		t.Fatal("run python tools/build-release.py --payload-only before Go tests: ", e)
	}
	var version struct{ Version string }
	versionBytes, _ := zipBytes(p.Files["app/package.json"], 8192)
	json.Unmarshal(versionBytes, &version)
	if p.Manifest.Version != version.Version || version.Version == "" {
		t.Fatal("wrong version")
	}
	if e = p.extract(t.TempDir(), nil); e != nil {
		t.Fatal(e)
	}
	if _, ok := p.Files["installer/ui/index.html"]; !ok {
		t.Fatal("GUI missing")
	}
	var a map[string]interface{}
	b, _ := zipBytes(p.Files["app/updates/config.json"], 4096)
	json.Unmarshal(b, &a)
	repository, ok := a["repository"].(map[string]interface{})
	publicKey, _ := a["publicKey"].(string)
	if !ok || repository["owner"] != "viktorstriuk" || repository["name"] != "PulseDeck" ||
		!strings.Contains(publicKey, "-----BEGIN PUBLIC KEY-----") || strings.Contains(publicKey, "PRIVATE KEY") {
		t.Fatal("official update source/public trust key missing or private trust material shipped")
	}
}
func TestPayloadDigestRejectsModifiedRecordBeforeWriting(t *testing.T) {
	p, e := loadPackage()
	if e != nil {
		t.Fatal(e)
	}
	p.Manifest.Files[0].SHA256 = strings.Repeat("0", 64)
	dest := t.TempDir()
	if e = p.extract(dest, nil); e == nil {
		t.Fatal("bad digest accepted")
	}
}
func TestInstallIntegrityFailsWithoutTouchingLegacyData(t *testing.T) {
	root, _ := layout(t)
	p, e := loadPackage()
	if e != nil {
		t.Fatal(e)
	}
	bad := archive(t, map[string]string{"electron.exe": "MZ"})
	e = install(p, bad, root, nil)
	if e == nil || !strings.Contains(e.Error(), "INTEGRITY") {
		t.Fatal(e)
	}
	if contents(t, filepath.Join(root, "PulseDeck.exe")) != "old exe" {
		t.Fatal("modified before verify")
	}
	userData(t, root)
}
func TestMockEndToEndInstallAndUninstallOnFilesystem(t *testing.T) {
	p, e := loadPackage()
	if e != nil {
		t.Fatal(e)
	}
	z := archive(t, map[string]string{"electron.exe": "MZruntime fixture", "LICENSE": "MIT", "LICENSES.chromium.html": "notices", "locales/en-US.pak": "locale", "resources/default_app.asar": "default"})
	hash, _ := fileHash(z)
	p.Manifest.Runtime.SHA256 = hash
	root := filepath.Join(t.TempDir(), "PulseDeck")
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("LOCALAPPDATA", t.TempDir())
	if e = installWithComponents(p, z, root, nil, fixtureProvisioner(t)); e != nil {
		t.Fatal(e)
	}
	if contents(t, filepath.Join(root, "PulseDeck.exe")) != "MZruntime fixture" {
		t.Fatal("runtime renamed incorrectly")
	}
	if _, e = os.Stat(filepath.Join(root, "resources/app/updates/manager.js")); e != nil {
		t.Fatal("app not installed")
	}
	put(t, filepath.Join(root, "music/user.wav"), "MUSIC")
	if e = uninstall(root, nil); e != nil {
		t.Fatal(e)
	}
	if contents(t, filepath.Join(root, "music/user.wav")) != "MUSIC" {
		t.Fatal("user track lost")
	}
}
func TestFileHashMatchesIndependentDigest(t *testing.T) {
	p := filepath.Join(t.TempDir(), "f")
	put(t, p, "hello")
	sum := sha256.Sum256([]byte("hello"))
	h, e := fileHash(p)
	if e != nil || h != hex.EncodeToString(sum[:]) {
		t.Fatal(h, e)
	}
}
