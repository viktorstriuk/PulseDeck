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

type setupLanguage struct{ Code, Locale string }

func packageLanguages(p *Package) []setupLanguage {
	out := []setupLanguage{}
	for name, file := range p.Files {
		if !strings.HasPrefix(name, "app/languages/") || !strings.HasSuffix(name, ".json") {
			continue
		}
		code := strings.TrimSuffix(strings.TrimPrefix(name, "app/languages/"), ".json")
		if strings.ContainsAny(code, "/\\") || code == "" {
			continue
		}
		raw, err := zipBytes(file, 2*1024*1024)
		if err != nil {
			continue
		}
		var c struct {
			Meta     struct{ Name, Code, Locale string }
			Messages map[string]json.RawMessage
		}
		if json.Unmarshal(raw, &c) != nil || c.Meta.Name == "" || c.Messages == nil || (c.Meta.Code != "" && c.Meta.Code != code) {
			continue
		}
		out = append(out, setupLanguage{code, c.Meta.Locale})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	return out
}
func languageID(s string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(s), "_", "-"))
}
func chooseLanguage(languages []setupLanguage, preferred []string, explicit string) string {
	find := func(s string) string {
		for _, l := range languages {
			if languageID(l.Code) == languageID(s) {
				return l.Code
			}
		}
		return ""
	}
	if explicit != "" {
		if found := find(explicit); found != "" {
			return found
		}
	}
	for _, s := range preferred {
		want := languageID(s)
		if want == "" {
			continue
		}
		if found := find(want); found != "" {
			return found
		}
		for _, l := range languages {
			if languageID(l.Locale) == want {
				return l.Code
			}
		}
		base := strings.Split(want, "-")[0]
		if found := find(base); found != "" {
			return found
		}
		for _, l := range languages {
			if strings.Split(languageID(l.Code), "-")[0] == base || strings.Split(languageID(l.Locale), "-")[0] == base {
				return l.Code
			}
		}
	}
	if found := find("en"); found != "" {
		return found
	}
	if len(languages) > 0 {
		return languages[0].Code
	}
	return "en"
}

// Normal setup follows Windows UI language; unattended application updates keep the app language.
func readLanguage(p *Package) string {
	explicit := arg("--language")
	if explicit == "" && flag("--apply") {
		var s struct{ Language string }
		b, _ := os.ReadFile(filepath.Join(profile(), "settings.json"))
		json.Unmarshal(b, &s)
		explicit = s.Language
	}
	return chooseLanguage(packageLanguages(p), preferredUILanguages(), explicit)
}

type languageSettings struct {
	file     string
	values   map[string]json.RawMessage
	previous []byte
}

// Read and validate before touching installed files. Preserve unknown settings, integer precision,
// user text and legacy profiles. A broken profile is never replaced with an empty default profile.
func prepareLanguageSettings(p *Package, target, profileDir, language string) (*languageSettings, error) {
	if language == "" {
		return nil, nil
	}
	valid := false
	for _, l := range packageLanguages(p) {
		if l.Code == language {
			valid = true
		}
	}
	if !valid {
		return nil, errors.New("SETUP_LANGUAGE")
	}
	file := filepath.Join(profileDir, "settings.json")
	if !noLinks(file) {
		return nil, errors.New("SETUP_SETTINGS")
	}
	values := map[string]json.RawMessage{}
	var previous []byte
	candidates := []string{file, filepath.Join(profileDir, "settings.backup.json"), filepath.Join(target, "data", "settings.json")}
	// The backup/legacy source is only used when the current settings file does not exist.
	for _, candidate := range candidates {
		st, err := os.Lstat(candidate)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil || !st.Mode().IsRegular() || st.Size() > 16*1024*1024 || !noLinks(candidate) {
			return nil, errors.New("SETUP_SETTINGS")
		}
		raw, err := os.ReadFile(candidate)
		if err != nil || json.Unmarshal(raw, &values) != nil || values == nil {
			return nil, errors.New("SETUP_SETTINGS")
		}
		previous = raw
		break
	}
	values["language"], _ = json.Marshal(language)
	return &languageSettings{file, values, previous}, nil
}
func persistLanguageSettings(plan *languageSettings) error {
	if plan == nil {
		return nil
	}
	if !noLinks(plan.file) || !noLinks(plan.file+".tmp") {
		return errors.New("SETUP_LANGUAGE_SAVE")
	}
	// Settings may have changed while setup was downloading. Merge only the chosen language.
	if st, err := os.Lstat(plan.file); err == nil {
		if !st.Mode().IsRegular() || st.Size() > 16*1024*1024 {
			return errors.New("SETUP_LANGUAGE_SAVE")
		}
		var latest map[string]json.RawMessage
		raw, readErr := os.ReadFile(plan.file)
		if readErr != nil || json.Unmarshal(raw, &latest) != nil || latest == nil {
			return errors.New("SETUP_LANGUAGE_SAVE")
		}
		latest["language"] = plan.values["language"]
		plan.values, plan.previous = latest, raw
	} else if !os.IsNotExist(err) {
		return errors.New("SETUP_LANGUAGE_SAVE")
	}
	if len(plan.previous) > 0 {
		folder := filepath.Join(filepath.Dir(plan.file), "backups")
		if !noLinks(folder) {
			return errors.New("SETUP_LANGUAGE_SAVE")
		}
		if err := os.MkdirAll(folder, 0700); err != nil {
			return fmt.Errorf("SETUP_LANGUAGE_SAVE: %w", err)
		}
		backup, err := os.OpenFile(filepath.Join(folder, "before-setup-language-"+time.Now().UTC().Format("20060102T150405.000000000")+".json"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return fmt.Errorf("SETUP_LANGUAGE_SAVE: %w", err)
		}
		_, err = backup.Write(plan.previous)
		if err == nil {
			err = backup.Sync()
		}
		backup.Close()
		if err != nil {
			return fmt.Errorf("SETUP_LANGUAGE_SAVE: %w", err)
		}
	}
	if err := atomicJSON(plan.file, plan.values); err != nil {
		return fmt.Errorf("SETUP_LANGUAGE_SAVE: %w", err)
	}
	return nil
}
