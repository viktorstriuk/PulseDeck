package main

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func Test296ProductVersionResource(t *testing.T) {
	for _, version := range []string{"2.9.6", "2.9.6-beta.1", "65535.65535.65535"} {
		b, err := versionResource(version)
		if err != nil {
			t.Fatal(err)
		}
		if int(binary.LittleEndian.Uint16(b)) != len(b) {
			t.Fatal("wrong resource block length")
		}
		for _, word := range []string{"VS_VERSION_INFO", "FileDescription", "ProductName", "PulseDeck", "PulseDeck.exe", version, "040904B0"} {
			if !bytes.Contains(b, wideBytes(word)) {
				t.Fatalf("missing UTF-16 field %q", word)
			}
		}
		if bytes.Contains(b, wideBytes("Electron")) {
			t.Fatal("unbranded runtime description")
		}
		if !bytes.Contains(b, []byte{0xbd, 0x04, 0xef, 0xfe}) {
			t.Fatal("missing VS_FIXEDFILEINFO signature")
		}
	}
	for _, version := range []string{"", "x.y.z", "1.2", "1.2.65536"} {
		if _, err := versionResource(version); err == nil {
			t.Fatalf("accepted %q", version)
		}
	}
}
func Test296ApplicationEnvironment(t *testing.T) {
	input := []string{"PATH=keep", "Electron_Run_As_Node=1", "NODE_OPTIONS=--require=x", "ELECTRON_NO_ASAR=1", "NODE_CHANNEL_FD=3", "NODE_CHANNEL_SERIALIZATION_MODE=json", "LOCALAPPDATA=C:\\User"}
	got := applicationEnvironment(input)
	if !reflect.DeepEqual(got, []string{"PATH=keep", "LOCALAPPDATA=C:\\User"}) {
		t.Fatalf("bad environment %v", got)
	}
	if len(input) != 7 {
		t.Fatal("mutated caller environment")
	}
}
func Test296LaunchFailureKeepsUpdateUndone(t *testing.T) {
	target := t.TempDir()
	var events []Event
	err := finishApplicationUpdate(context.Background(), target, "2.9.6", true, func(e Event) { events = append(events, e) })
	if err == nil {
		t.Fatal("missing executable reported success")
	}
	if len(events) != 1 || events[0].Phase != "launching" {
		t.Fatalf("premature done %v", events)
	}
	code, _ := errorData(err)
	if code != "SetupLaunchFailed" {
		t.Fatal(code)
	}
	code, _ = errorData(errors.New("SETUP_LAUNCH_TIMEOUT: no visible window"))
	if code != "SetupLaunchTimeout" {
		t.Fatal(code)
	}
}
func Test296UpdateWithoutRelaunchNeedsNoExecutable(t *testing.T) {
	var events []Event
	if err := finishApplicationUpdate(context.Background(), t.TempDir(), "2.9.6", false, func(e Event) { events = append(events, e) }); err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].Phase != "done" {
		t.Fatalf("unexpected event %v", events)
	}
}
func Test296BrandingIsBeforeCommittedRuntime(t *testing.T) {
	// Structural guard complements transaction fault injection and the real
	// Windows PE API acceptance check. No installed executable is ever branded.
	b, err := os.ReadFile(filepath.Join("main.go"))
	if err != nil {
		t.Fatal(err)
	}
	brand, commit := bytes.Index(b, []byte("brandRuntime(")), bytes.Index(b, []byte("commitStage("))
	if brand < 0 || commit < brand {
		t.Fatal("resource editing escaped staging")
	}
}
