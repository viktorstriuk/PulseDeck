package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func languagePackage(t *testing.T) *Package {
	t.Helper()
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	for code, locale := range map[string]string{"ru": "ru-RU", "en": "en-GB", "pt-BR": "pt-BR"} {
		w, _ := z.Create("app/languages/" + code + ".json")
		json.NewEncoder(w).Encode(map[string]interface{}{"meta": map[string]string{"code": code, "name": code, "locale": locale}, "messages": map[string]string{"SetupTitle": "Test"}})
	}
	w, _ := z.Create("app/languages/broken.json")
	w.Write([]byte("{"))
	z.Close()
	r, e := zip.NewReader(bytes.NewReader(b.Bytes()), int64(b.Len()))
	if e != nil {
		t.Fatal(e)
	}
	p := &Package{Files: map[string]*zip.File{}}
	for _, f := range r.File {
		p.Files[f.Name] = f
	}
	return p
}
func TestLanguageCatalogDiscovery(t *testing.T) {
	l := packageLanguages(languagePackage(t))
	if len(l) != 3 || l[0].Code != "en" || l[2].Code != "ru" {
		t.Fatal(l)
	}
}
func TestLanguageMatching(t *testing.T) {
	l := []setupLanguage{{"en", "en-GB"}, {"ru", "ru-RU"}, {"pt-BR", "pt-BR"}}
	for _, c := range []struct {
		name           string
		p              []string
		explicit, want string
	}{
		{"system Russian", []string{"ru-RU"}, "", "ru"}, {"system English region", []string{"en-US"}, "", "en"},
		{"ordered UI preferences", []string{"de-DE", "ru-RU", "en-GB"}, "", "ru"}, {"unsupported", []string{"de-DE"}, "", "en"},
		{"explicit choice", []string{"ru-RU"}, "en", "en"}, {"invalid explicit", []string{"ru-RU"}, "../../x", "ru"},
		{"regional pack", []string{"pt-PT"}, "", "pt-BR"}, {"underscore locale", []string{"RU_ru"}, "", "ru"},
	} {
		t.Run(c.name, func(t *testing.T) {
			if got := chooseLanguage(l, c.p, c.explicit); got != c.want {
				t.Fatalf("%s != %s", got, c.want)
			}
		})
	}
}
func TestFreshSetupSavesSelectedLanguage(t *testing.T) {
	profile := filepath.Join(t.TempDir(), "profile")
	plan, e := prepareLanguageSettings(languagePackage(t), t.TempDir(), profile, "en")
	if e != nil {
		t.Fatal(e)
	}
	if e = persistLanguageSettings(plan); e != nil {
		t.Fatal(e)
	}
	var data map[string]interface{}
	json.Unmarshal([]byte(contents(t, filepath.Join(profile, "settings.json"))), &data)
	if data["language"] != "en" || len(data) != 1 {
		t.Fatal(data)
	}
}
func TestSetupLanguagePreservesSettingsAndByteBackup(t *testing.T) {
	profile := t.TempDir()
	file := filepath.Join(profile, "settings.json")
	old := `{"language":"ru","counter":9007199254740993,"favorites":["a.wav"],"playerOverlay":{"label":"Мой текст — не менять."},"volume":0.27}`
	put(t, file, old)
	plan, e := prepareLanguageSettings(languagePackage(t), t.TempDir(), profile, "en")
	if e != nil {
		t.Fatal(e)
	}
	if contents(t, file) != old {
		t.Fatal("prepare wrote settings")
	}
	if e = persistLanguageSettings(plan); e != nil {
		t.Fatal(e)
	}
	var data map[string]json.RawMessage
	json.Unmarshal([]byte(contents(t, file)), &data)
	if string(data["language"]) != `"en"` || string(data["counter"]) != "9007199254740993" || !strings.Contains(string(data["playerOverlay"]), "— не менять.") {
		t.Fatal(data)
	}
	backups, _ := filepath.Glob(filepath.Join(profile, "backups", "before-setup-language-*.json"))
	if len(backups) != 1 || contents(t, backups[0]) != old {
		t.Fatal("backup is not exact")
	}
}
func TestSetupLanguagePreservesConcurrentSettingsEdit(t *testing.T) {
	profile := t.TempDir()
	file := filepath.Join(profile, "settings.json")
	put(t, file, `{"language":"ru","volume":0.5}`)
	p, e := prepareLanguageSettings(languagePackage(t), t.TempDir(), profile, "en")
	if e != nil {
		t.Fatal(e)
	}
	put(t, file, `{"language":"ru","volume":0.9,"theme":"nord"}`)
	if e = persistLanguageSettings(p); e != nil {
		t.Fatal(e)
	}
	var d map[string]interface{}
	json.Unmarshal([]byte(contents(t, file)), &d)
	if d["language"] != "en" || d["volume"] != 0.9 || d["theme"] != "nord" {
		t.Fatal(d)
	}
}
func TestLanguageUsesLegacySettingsOnlyIfProfileAbsent(t *testing.T) {
	target, profile := t.TempDir(), t.TempDir()
	put(t, filepath.Join(target, "data/settings.json"), `{"favorites":["keep.wav"],"theme":"ocean"}`)
	p, e := prepareLanguageSettings(languagePackage(t), target, profile, "ru")
	if e != nil {
		t.Fatal(e)
	}
	if e = persistLanguageSettings(p); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(contents(t, filepath.Join(profile, "settings.json")), "keep.wav") {
		t.Fatal("lost legacy settings")
	}
}
func TestBrokenProfileNeverOverwritten(t *testing.T) {
	profile := t.TempDir()
	file := filepath.Join(profile, "settings.json")
	put(t, file, `{"broken"`)
	put(t, filepath.Join(profile, "settings.backup.json"), `{"language":"ru"}`)
	if _, e := prepareLanguageSettings(languagePackage(t), t.TempDir(), profile, "en"); e == nil {
		t.Fatal("corrupt primary accepted")
	}
	if contents(t, file) != `{"broken"` {
		t.Fatal("corrupt primary overwritten")
	}
}
func TestLanguageRejectsUnshippedCodeBeforeWrites(t *testing.T) {
	profile := t.TempDir()
	if _, e := prepareLanguageSettings(languagePackage(t), t.TempDir(), profile, "de"); e == nil {
		t.Fatal("unknown code accepted")
	}
	files, _ := os.ReadDir(profile)
	if len(files) != 0 {
		t.Fatal("wrote before validating")
	}
}
func TestUnattendedLanguageNoOp(t *testing.T) {
	profile := t.TempDir()
	p, e := prepareLanguageSettings(languagePackage(t), t.TempDir(), profile, "")
	if e != nil || p != nil {
		t.Fatal(p, e)
	}
	if e = persistLanguageSettings(p); e != nil {
		t.Fatal(e)
	}
	files, _ := os.ReadDir(profile)
	if len(files) != 0 {
		t.Fatal("unattended changed settings")
	}
}
func TestLanguageRejectsSymlinkPrimaryOrTemp(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("requires symlink privilege")
	}
	for _, suffix := range []string{"", ".tmp"} {
		t.Run(suffix, func(t *testing.T) {
			profile := t.TempDir()
			external := filepath.Join(t.TempDir(), "outside")
			put(t, external, `{"theme":"light"}`)
			file := filepath.Join(profile, "settings.json")
			if e := os.Symlink(external, file+suffix); e != nil {
				t.Fatal(e)
			}
			plan, e := prepareLanguageSettings(languagePackage(t), t.TempDir(), profile, "ru")
			if suffix == "" {
				if e == nil {
					t.Fatal("accepted symlink")
				}
			} else {
				if e != nil {
					t.Fatal(e)
				}
				if persistLanguageSettings(plan) == nil {
					t.Fatal("accepted symlink temp")
				}
			}
			if contents(t, external) != `{"theme":"light"}` {
				t.Fatal("external file changed")
			}
		})
	}
}
func TestSetupReadLanguageUsesUIEnvironmentNotSavedApp(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows UI preferences require native session")
	}
	p := languagePackage(t)
	t.Setenv("APPDATA", t.TempDir())
	t.Setenv("LANGUAGE", "ru_RU.UTF-8:en_GB.UTF-8")
	put(t, filepath.Join(profile(), "settings.json"), `{"language":"en"}`)
	old := os.Args
	defer func() { os.Args = old }()
	os.Args = []string{"setup"}
	if readLanguage(p) != "ru" {
		t.Fatal("installer did not follow UI language")
	}
	os.Args = []string{"setup", "--apply"}
	if readLanguage(p) != "en" {
		t.Fatal("unattended did not preserve app language")
	}
	os.Args = []string{"setup", "--language=en"}
	if readLanguage(p) != "en" {
		t.Fatal("explicit choice ignored")
	}
}
