package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

func arg(name string) string {
	for i, a := range os.Args[1:] {
		if a == name && i+2 < len(os.Args) {
			return os.Args[i+2]
		}
		if strings.HasPrefix(a, name+"=") {
			return strings.TrimPrefix(a, name+"=")
		}
	}
	return ""
}
func flag(name string) bool {
	for _, a := range os.Args[1:] {
		if a == name {
			return true
		}
	}
	return false
}
func profile() string {
	base := os.Getenv("APPDATA")
	if base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, "PulseDeck")
}
func localProfile() string {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		base = os.Getenv("APPDATA")
	}
	if base == "" {
		base = os.TempDir()
	}
	return filepath.Join(base, "PulseDeck")
}
func diagnostic(e error) {
	if e == nil {
		return
	}
	diagnosticReport(e, "", "", "background")
}
func dictionary(p *Package, language string) map[string]string {
	out := map[string]string{}
	for _, code := range []string{"en", language} {
		f, ok := p.Files["app/languages/"+code+".json"]
		if !ok {
			continue
		}
		b, e := zipBytes(f, 2*1024*1024)
		if e != nil {
			continue
		}
		var c struct {
			Messages map[string]interface{} `json:"messages"`
		}
		if json.Unmarshal(b, &c) == nil {
			for k, v := range c.Messages {
				if text, ok := v.(string); ok && text != "" {
					out[k] = text
				}
			}
		}
	}
	return out
}
func defaultTarget() string {
	var saved struct {
		Target string `json:"target"`
	}
	if b, e := os.ReadFile(filepath.Join(localProfile(), "installation.json")); e == nil {
		json.Unmarshal(b, &saved)
		if filepath.IsAbs(saved.Target) {
			if _, e = os.Stat(filepath.Join(saved.Target, "resources", "app", "package.json")); e == nil {
				return saved.Target
			}
		}
	}
	for _, candidate := range []string{filepath.Join(os.Getenv("USERPROFILE"), "Desktop", "PulseDeck"), filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "PulseDeck")} {
		if _, e := os.Stat(filepath.Join(candidate, "resources", "app", "package.json")); e == nil {
			return candidate
		}
	}
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "PulseDeck")
}
func install(p *Package, archive, target string, notify func(Event)) error {
	return installWithComponents(p, archive, target, notify, func(ctx context.Context, target string, pins map[string]ComponentPin, notify func(Event)) error {
		return provisionSetupComponents(ctx, target, pins, componentDownload, probeSetupComponent, notify)
	})
}
func installWithComponents(p *Package, archive, target string, notify func(Event), provision func(context.Context, string, map[string]ComponentPin, func(Event)) error) error {
	full, e := validateTarget(target)
	if e != nil {
		return e
	}
	target = full
	language := arg("--language")
	if flag("--apply") {
		language = ""
	} // Never reset a user's language during unattended updates
	languagePlan, e := prepareLanguageSettings(p, target, profile(), language)
	if e != nil {
		return e
	}
	if e = os.MkdirAll(target, 0700); e != nil {
		return e
	}
	// One installation per directory; abandoned locks carry a PID and are recovered.
	lock := filepath.Join(target, ".pulsedeck-install.lock")
	if data, err := os.ReadFile(lock); err == nil {
		pid, _ := strconv.Atoi(strings.TrimSpace(string(data)))
		if pid > 0 && processAlive(pid) {
			return errors.New("SETUP_LOCKED")
		}
		os.Remove(lock)
	}
	f, e := os.OpenFile(lock, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	fmt.Fprint(f, os.Getpid())
	f.Close()
	defer os.Remove(lock)
	if e = recoverTransaction(target, notify); e != nil {
		return e
	}
	if processAt(filepath.Join(target, "PulseDeck.exe")) {
		return errors.New("SETUP_LOCKED")
	}
	actual, e := fileHash(archive)
	if e != nil {
		return e
	}
	if actual != p.Manifest.Runtime.SHA256 {
		return errors.New("SETUP_INTEGRITY")
	}
	const installReserve uint64 = 1200 * 1024 * 1024
	if free, ok := freeSpace(target); !ok || free < installReserve {
		data := map[string]string{"drive": driveLabel(target), "needed": formatBytes(installReserve)}
		if ok {
			data["available"] = formatBytes(free)
		}
		return setupFail("SetupErrorDisk", errors.New("SETUP_DISK"), data)
	}
	if notify != nil {
		notify(Event{Phase: "verifying"})
	}
	if e = preserveProfile(target, profile()); e != nil {
		return e
	}
	// Record legacy locations before installing the first new-layout release.
	if e = preserveLegacyLocations(target); e != nil {
		return e
	}
	stage, e := os.MkdirTemp(target, ".pulsedeck-stage-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(stage)
	if e = extractRuntime(archive, stage); e != nil {
		return e
	}
	if e = os.Rename(filepath.Join(stage, "electron.exe"), filepath.Join(stage, "PulseDeck.exe")); e != nil {
		return e
	}
	extracted, e := os.MkdirTemp(target, ".pulsedeck-payload-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(extracted)
	if e = p.extract(extracted, notify); e != nil {
		return e
	}
	if e = os.MkdirAll(filepath.Join(stage, "resources"), 0700); e != nil {
		return e
	}
	if e = copyTree(filepath.Join(extracted, "app"), filepath.Join(stage, "resources", "app")); e != nil {
		return e
	}
	self, e := os.Executable()
	if e != nil {
		return e
	}
	if e = copyFile(self, filepath.Join(stage, "Uninstall PulseDeck.exe"), 0600); e != nil {
		return e
	}
	// Components are provisioned before the application is committed. A network
	// or integrity failure leaves the old executable usable, not a "done" screen.
	pins, err := readComponentPins(filepath.Join(stage, "resources", "app", "updates", "pins.json"))
	if err != nil {
		return fmt.Errorf("SETUP_COMPONENTS: %w", err)
	}
	if e = provision(context.Background(), target, pins, notify); e != nil {
		return fmt.Errorf("SETUP_COMPONENTS: %w", e)
	}
	if e = commitStage(target, stage, p.Manifest.Version, notify, nil); e != nil {
		return e
	}
	if notify != nil {
		notify(Event{Phase: "finalizing"})
	}
	if e = atomicJSON(filepath.Join(localProfile(), "installation.json"), map[string]string{"target": target, "version": p.Manifest.Version}); e != nil {
		diagnostic(e)
	}
	if e = registerApplication(target, p.Manifest.Version); e != nil {
		diagnostic(e)
	}
	if flag("--desktop") {
		if e = createAppShortcut(target); e != nil {
			diagnostic(e)
		}
	}
	if e = persistLanguageSettings(languagePlan); e != nil {
		return e
	}
	if notify != nil {
		notify(Event{Phase: "done", Percent: 100, Target: target})
	}
	return nil
}
func copyTree(source, target string) error {
	return filepath.WalkDir(source, func(file string, d os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.Type()&os.ModeSymlink != 0 {
			return errors.New("unsafe copy source")
		}
		rel, e := filepath.Rel(source, file)
		if e != nil {
			return e
		}
		to := filepath.Join(target, rel)
		if d.IsDir() {
			return os.MkdirAll(to, 0700)
		}
		return copyFile(file, to, 0600)
	})
}
func preserveLegacyLocations(target string) error {
	config := filepath.Join(profile(), "storage.json")
	if _, e := os.Stat(config); e == nil {
		return nil
	}
	if _, e := os.Stat(filepath.Join(target, "resources", "app", "package.json")); e != nil {
		return nil
	}
	home := os.Getenv("USERPROFILE")
	music := filepath.Join(target, "music")
	if !regularDirectory(music) {
		music = filepath.Join(home, "Music", "PulseDeck")
	}
	data := filepath.Join(target, "data")
	if !regularDirectory(data) {
		data = filepath.Join(localProfile(), "data")
	}
	settings := filepath.Join(profile(), "settings.json")
	if _, e := os.Stat(settings); e == nil {
		backup := filepath.Join(profile(), "backups", "before-storage-v1.json")
		if _, err := os.Stat(backup); os.IsNotExist(err) {
			if err = copyFile(settings, backup, 0600); err != nil {
				return err
			}
		}
	}
	return atomicJSON(config, map[string]interface{}{"schema": 1, "music": music, "data": data, "tools": filepath.Join(target, "components"), "languages": filepath.Join(profile(), "languages"), "legacyRoot": target})
}
func uninstall(target string, notify func(Event)) error {
	full, e := validateTarget(target)
	if e != nil {
		return e
	}
	if processAt(filepath.Join(full, "PulseDeck.exe")) {
		return errors.New("SETUP_LOCKED")
	}
	var r Receipt
	b, e := os.ReadFile(filepath.Join(full, ".pulsedeck-install.json"))
	if e != nil {
		return e
	}
	if json.Unmarshal(b, &r) != nil || r.Product != "com.pulsedeck.music" || r.Schema != 1 {
		return errors.New("SETUP_PATH")
	}
	for _, name := range r.Owned {
		if !ownedName(name) {
			return errors.New("invalid ownership receipt")
		}
	}
	for i, name := range r.Owned {
		dst := filepath.Join(full, filepath.FromSlash(name))
		if !noLinks(dst) {
			return errors.New("unsafe uninstall path")
		}
		if e = os.RemoveAll(dst); e != nil {
			return e
		}
		if notify != nil {
			notify(Event{Phase: "installing", Percent: float64(i+1) / float64(len(r.Owned)) * 100})
		}
	}
	unregisterApplication(full)
	os.Remove(filepath.Join(full, ".pulsedeck-install.json"))
	if notify != nil {
		notify(Event{Phase: "removed", Percent: 100, Target: full})
	}
	return nil
}
func runGUI(ctx context.Context, p *Package, notify func(Event)) error {
	archive, e := ensureRuntime(ctx, p, notify)
	if e != nil {
		return e
	}
	root, e := os.MkdirTemp("", "PulseDeck-Setup-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(root)
	if notify != nil {
		notify(Event{Phase: "extracting"})
	}
	runtime := filepath.Join(root, "runtime")
	if e = extractRuntime(archive, runtime); e != nil {
		return e
	}
	if e = p.extract(root, notify); e != nil {
		return e
	}
	self, e := os.Executable()
	if e != nil {
		return e
	}
	engine := filepath.Join(root, "maintenance.exe")
	if e = copyFile(self, engine, 0600); e != nil {
		return e
	}
	args := []string{filepath.Join(root, "installer", "ui"), "--engine=" + engine, "--runtime-archive=" + archive, "--target=" + defaultTarget(), "--language=" + readLanguage(p)}
	if strings.HasPrefix(strings.ToLower(filepath.Base(self)), "uninstall") || flag("--uninstall") {
		target := arg("--target")
		if target == "" {
			target = filepath.Dir(self)
		}
		args = append(args, "--uninstall-target="+target)
	}
	cmd := exec.Command(filepath.Join(runtime, "electron.exe"), args...)
	hideProcess(cmd)
	if e = cmd.Start(); e != nil {
		return e
	}
	if notify != nil {
		notify(Event{Phase: "gui"})
	}
	return cmd.Wait()
}
func main() {
	// Release the installed uninstaller executable before the detached copy removes it.
	self, _ := os.Executable()
	if strings.HasPrefix(strings.ToLower(filepath.Base(self)), "uninstall") && !flag("--engine") {
		temp, err := os.MkdirTemp("", "PulseDeck-Uninstall-")
		if err != nil {
			diagnostic(err)
			return
		}
		copy := filepath.Join(temp, "maintenance.exe")
		if err = copyFile(self, copy, 0600); err != nil {
			diagnostic(err)
			return
		}
		cmd := exec.Command(copy, "--uninstall", "--target", filepath.Dir(self))
		hideProcess(cmd)
		if err = cmd.Start(); err != nil {
			diagnostic(err)
		}
		return
	}
	p, e := loadPackage()
	if e != nil {
		diagnostic(e)
		return
	}
	language := readLanguage(p)
	words := dictionary(p, language)
	if flag("--engine") {
		notify := func(ev Event) { json.NewEncoder(os.Stdout).Encode(ev) }
		if flag("--uninstall") {
			e = uninstall(arg("--target"), notify)
		} else {
			e = install(p, arg("--runtime-archive"), arg("--target"), notify)
		}
		if e != nil {
			target := arg("--target")
			mode := "install"
			if flag("--uninstall") {
				mode = "uninstall"
			}
			report := diagnosticReport(e, target, p.Manifest.Version, mode)
			code, data := errorData(e)
			if code == "SetupErrorDisk" {
				if data == nil {
					data = map[string]string{}
				}
				if data["drive"] == "" {
					data["drive"] = driveLabel(target)
				}
				if data["needed"] == "" {
					data["needed"] = formatBytes(1200 * 1024 * 1024)
				}
			}
			notify(Event{Phase: "error", Error: code, Data: data, Report: report, Target: target})
			os.Exit(1)
		}
		return
	}
	if flag("--apply") {
		target := arg("--target")
		pid, _ := strconv.Atoi(arg("--wait-pid"))
		e = showSplash(p, words, func(ctx context.Context, notify func(Event)) error {
			notify(Event{Phase: "waiting"})
			if pid > 0 {
				if err := waitProcess(ctx, pid, 2*time.Minute); err != nil {
					return err
				}
			}
			archive, err := ensureRuntime(ctx, p, notify)
			if err != nil {
				return err
			}
			return install(p, archive, target, notify)
		})
		if e != nil {
			diagnostic(e)
		}
		if flag("--restart") {
			args := []string{}
			if e != nil {
				args = append(args, "--update-failed")
			}
			cmd := exec.Command(filepath.Join(target, "PulseDeck.exe"), args...)
			hideProcess(cmd)
			if err := cmd.Start(); err != nil {
				diagnostic(err)
			}
		}
		return
	}
	e = showSplash(p, words, func(ctx context.Context, notify func(Event)) error { return runGUI(ctx, p, notify) })
	if e != nil {
		diagnostic(e)
	}
}
