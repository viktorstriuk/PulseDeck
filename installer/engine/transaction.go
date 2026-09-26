package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Event struct {
	Phase   string  `json:"phase"`
	Percent float64 `json:"percent,omitempty"`
	Done    int     `json:"done,omitempty"`
	Total   int     `json:"total,omitempty"`
	Error   string  `json:"error,omitempty"`
	Target  string  `json:"target,omitempty"`
	Message string  `json:"message,omitempty"`
}
type Operation struct {
	Name   string `json:"name"`
	HadOld bool   `json:"hadOld"`
	Intent bool   `json:"intent"`
	New    bool   `json:"new"`
}
type Journal struct {
	Schema     int             `json:"schema"`
	Backup     string          `json:"backup"`
	Stage      string          `json:"stage"`
	Committed  bool            `json:"committed"`
	Operations []Operation     `json:"operations"`
	OldReceipt json.RawMessage `json:"oldReceipt,omitempty"`
}
type Receipt struct {
	Schema      int      `json:"schema"`
	Product     string   `json:"product"`
	Version     string   `json:"version"`
	Owned       []string `json:"owned"`
	InstalledAt string   `json:"installedAt"`
	Previous    string   `json:"previous,omitempty"`
}

func atomicJSON(file string, v interface{}) error {
	data, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Dir(file), 0700); e != nil {
		return e
	}
	tmp := file + ".tmp"
	f, e := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	if _, e = f.Write(data); e == nil {
		e = f.Sync()
	}
	f.Close()
	if e != nil {
		return e
	}
	return replaceAtomic(tmp, file)
}
func regularDirectory(dir string) bool {
	s, e := os.Lstat(dir)
	return e == nil && s.IsDir() && s.Mode()&os.ModeSymlink == 0
}
func noLinks(dir string) bool {
	for {
		st, e := os.Lstat(dir)
		if e == nil && st.Mode()&os.ModeSymlink != 0 {
			return false
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return true
		}
		dir = parent
	}
}
func validateTarget(target string) (string, error) {
	if !filepath.IsAbs(strings.TrimSpace(target)) {
		return "", errors.New("SETUP_PATH")
	}
	full, e := filepath.Abs(strings.TrimSpace(target))
	if e != nil {
		return "", e
	}
	full = filepath.Clean(full)
	if full == filepath.Dir(full) || len(filepath.Base(full)) < 3 || !noLinks(full) || strings.ContainsAny(full, "\r\n\x00") {
		return "", errors.New("SETUP_PATH")
	}
	for _, name := range []string{"SystemRoot", "WINDIR", "ProgramFiles", "ProgramFiles(x86)", "ProgramData", "USERPROFILE", "APPDATA", "LOCALAPPDATA"} {
		p := os.Getenv(name)
		if p != "" && strings.EqualFold(full, filepath.Clean(p)) {
			return "", errors.New("SETUP_PATH")
		}
	}
	system := os.Getenv("SystemRoot")
	if system != "" && strings.HasPrefix(strings.ToLower(full)+string(os.PathSeparator), strings.ToLower(filepath.Clean(system))+string(os.PathSeparator)) {
		return "", errors.New("SETUP_PATH")
	}
	entries, err := os.ReadDir(full)
	if os.IsNotExist(err) {
		return full, nil
	}
	if err != nil {
		return "", err
	}
	if len(entries) == 0 {
		return full, nil
	}
	receipt := Receipt{}
	data, err := os.ReadFile(filepath.Join(full, ".pulsedeck-install.json"))
	if err == nil && json.Unmarshal(data, &receipt) == nil && receipt.Product == "com.pulsedeck.music" && receipt.Schema == 1 {
		return full, nil
	}
	var pkg struct {
		Name string `json:"name"`
	}
	data, err = os.ReadFile(filepath.Join(full, "resources", "app", "package.json"))
	if err == nil && json.Unmarshal(data, &pkg) == nil && pkg.Name == "pulsedeck" {
		return full, nil
	}
	// An interrupted first install can only be resumed with a valid journal.
	var j Journal
	data, err = os.ReadFile(filepath.Join(full, ".pulsedeck-journal.json"))
	if err == nil && json.Unmarshal(data, &j) == nil && validJournal(j) {
		return full, nil
	}
	return "", errors.New("SETUP_PATH")
}

// An ownership receipt never authorizes deletion of arbitrary user directories.
func ownedName(s string) bool {
	if !safeRelative(s) {
		return false
	}
	switch s {
	case "resources/app", "resources/default_app.asar", "PulseDeck.exe", "Uninstall PulseDeck.exe", "LICENSE", "LICENSES.chromium.html", "LICENSE.electron.txt", "version", "locales", "chrome_100_percent.pak", "chrome_200_percent.pak", "resources.pak", "snapshot_blob.bin", "v8_context_snapshot.bin", "icudtl.dat", "d3dcompiler_47.dll", "ffmpeg.dll", "libEGL.dll", "libGLESv2.dll", "vk_swiftshader.dll", "vk_swiftshader_icd.json", "vulkan-1.dll", "dxcompiler.dll", "dxil.dll", "notification_helper.exe", "chrome_elf.dll":
		return true
	}
	return false
}
func validJournal(j Journal) bool {
	if j.Schema != 1 || !strings.HasPrefix(j.Backup, ".pulsedeck-rollback-") || filepath.Base(j.Backup) != j.Backup || !strings.HasPrefix(j.Stage, ".pulsedeck-stage-") || filepath.Base(j.Stage) != j.Stage {
		return false
	}
	for _, o := range j.Operations {
		if !ownedName(o.Name) {
			return false
		}
	}
	return true
}
func recoverTransaction(target string, notify func(Event)) error {
	file := filepath.Join(target, ".pulsedeck-journal.json")
	raw, e := os.ReadFile(file)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil {
		return e
	}
	var j Journal
	if json.Unmarshal(raw, &j) != nil || !validJournal(j) {
		return errors.New("invalid recovery journal")
	}
	if !noLinks(filepath.Join(target, j.Backup)) || !noLinks(filepath.Join(target, j.Stage)) {
		return errors.New("unsafe recovery path")
	}
	if j.Committed {
		return os.Remove(file)
	}
	if notify != nil {
		notify(Event{Phase: "rollback"})
	}
	var recoveryErr error
	for i := len(j.Operations) - 1; i >= 0; i-- {
		o := j.Operations[i]
		dst := filepath.Join(target, filepath.FromSlash(o.Name))
		old := filepath.Join(target, j.Backup, filepath.FromSlash(o.Name))
		_, oldErr := os.Lstat(old)
		// The old backup is authoritative even if a power failure preceded the journal update.
		if !noLinks(dst) || !noLinks(old) {
			return errors.New("unsafe recovery operation")
		}
		if oldErr == nil {
			if e = os.RemoveAll(dst); e == nil {
				e = os.MkdirAll(filepath.Dir(dst), 0700)
			}
			if e == nil {
				e = os.Rename(old, dst)
			}
			if e != nil {
				recoveryErr = e
			}
		}
		if os.IsNotExist(oldErr) && !o.HadOld && o.Intent {
			if e = os.RemoveAll(dst); e != nil {
				recoveryErr = e
			}
		}
	}
	if recoveryErr != nil {
		return recoveryErr
	}
	receiptFile := filepath.Join(target, ".pulsedeck-install.json")
	if len(j.OldReceipt) > 0 {
		var old Receipt
		if json.Unmarshal(j.OldReceipt, &old) != nil || old.Product != "com.pulsedeck.music" {
			return errors.New("invalid recovery receipt")
		}
		if e = atomicJSON(receiptFile, old); e != nil {
			return e
		}
	} else {
		os.Remove(receiptFile)
	}
	os.RemoveAll(filepath.Join(target, j.Stage))
	return os.Remove(file)
}

// Only these staged top-level groups move. The app tree is one atomic rename.
func stageGroups(stage string) ([]string, error) {
	entries, e := os.ReadDir(stage)
	if e != nil {
		return nil, e
	}
	var names []string
	for _, entry := range entries {
		n := entry.Name()
		if n == "resources" {
			nested, err := os.ReadDir(filepath.Join(stage, n))
			if err != nil {
				return nil, err
			}
			for _, sub := range nested {
				v := "resources/" + sub.Name()
				if !ownedName(v) {
					return nil, errors.New("invalid staged resource")
				}
				names = append(names, v)
			}
		} else if ownedName(n) {
			names = append(names, n)
		} else {
			return nil, errors.New("invalid staged root")
		}
	}
	sort.Strings(names)
	return names, nil
}
func commitStage(target, stage, version string, notify func(Event), hook func(int) error) error {
	if !noLinks(stage) || !strings.HasPrefix(filepath.Base(stage), ".pulsedeck-stage-") || filepath.Dir(stage) != target {
		return errors.New("unsafe staging directory")
	}
	names, e := stageGroups(stage)
	if e != nil {
		return e
	}
	backupName := ".pulsedeck-rollback-" + time.Now().UTC().Format("20060102T150405.000000000")
	j := Journal{Schema: 1, Backup: backupName, Stage: filepath.Base(stage)}
	if old, err := os.ReadFile(filepath.Join(target, ".pulsedeck-install.json")); err == nil {
		var r Receipt
		if json.Unmarshal(old, &r) != nil || r.Product != "com.pulsedeck.music" {
			return errors.New("invalid ownership receipt")
		}
		j.OldReceipt = old
	}
	for _, n := range names {
		if !noLinks(filepath.Join(target, filepath.FromSlash(n))) {
			return errors.New("unsafe installation path")
		}
		_, err := os.Lstat(filepath.Join(target, filepath.FromSlash(n)))
		j.Operations = append(j.Operations, Operation{Name: n, HadOld: err == nil})
	}
	journalFile := filepath.Join(target, ".pulsedeck-journal.json")
	if e = atomicJSON(journalFile, j); e != nil {
		return e
	}
	success := false
	defer func() {
		if !success {
			recoverTransaction(target, notify)
		}
	}()
	for i := range j.Operations {
		o := &j.Operations[i]
		o.Intent = true
		if e = atomicJSON(journalFile, j); e != nil {
			return e
		}
		dst := filepath.Join(target, filepath.FromSlash(o.Name))
		old := filepath.Join(target, j.Backup, filepath.FromSlash(o.Name))
		if o.HadOld {
			if e = os.MkdirAll(filepath.Dir(old), 0700); e != nil {
				return e
			}
			if e = os.Rename(dst, old); e != nil {
				return fmt.Errorf("SETUP_LOCKED: %w", e)
			}
		}
		if hook != nil {
			if e = hook(i); e != nil {
				return e
			}
		}
		if e = os.MkdirAll(filepath.Dir(dst), 0700); e != nil {
			return e
		}
		if e = os.Rename(filepath.Join(stage, filepath.FromSlash(o.Name)), dst); e != nil {
			return e
		}
		o.New = true
		if e = atomicJSON(journalFile, j); e != nil {
			return e
		}
		if notify != nil {
			notify(Event{Phase: "installing", Done: i + 1, Total: len(names), Percent: float64(i+1) / float64(len(names)) * 100})
		}
	}
	r := Receipt{Schema: 1, Product: "com.pulsedeck.music", Version: version, Owned: names, InstalledAt: time.Now().UTC().Format(time.RFC3339), Previous: backupName}
	if e = atomicJSON(filepath.Join(target, ".pulsedeck-install.json"), r); e != nil {
		return e
	}
	j.Committed = true
	if e = atomicJSON(journalFile, j); e != nil {
		return e
	}
	success = true
	os.Remove(journalFile)
	os.RemoveAll(stage)
	return nil
}
func preserveProfile(target, profile string) error {
	old := filepath.Join(target, "resources", "app", "languages")
	if !regularDirectory(old) {
		return nil
	}
	// Only on the transition: later releases ship defaults under app/, and user
	// overrides already live in the profile. Never overwrite those overrides.
	if _, e := os.Stat(filepath.Join(profile, "languages", ".migrated-280")); e == nil {
		return nil
	}
	backup := filepath.Join(profile, "backups", "languages-"+time.Now().UTC().Format("20060102T150405.000000000"))
	e := filepath.WalkDir(old, func(file string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type()&os.ModeSymlink != 0 {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(d.Name()))
		if ext != ".json" && ext != ".svg" {
			return nil
		}
		st, err := d.Info()
		if err != nil {
			return err
		}
		if st.Size() > 2*1024*1024 {
			return errors.New("language file too large")
		}
		rel, err := filepath.Rel(old, file)
		if err != nil {
			return err
		}
		if err = copyFile(file, filepath.Join(backup, rel), 0600); err != nil {
			return err
		}
		dst := filepath.Join(profile, "languages", rel)
		if _, err = os.Stat(dst); os.IsNotExist(err) {
			return copyFile(file, dst, 0600)
		}
		return nil
	})
	if e != nil {
		return e
	}
	os.MkdirAll(filepath.Join(profile, "languages"), 0700)
	return os.WriteFile(filepath.Join(profile, "languages", ".migrated-280"), []byte("1\n"), 0600)
}
