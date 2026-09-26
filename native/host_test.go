package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"
)

type testPlatform struct {
	client        *rtssClient
	mutexHeld     bool
	mutexReleased int
	windows       []candidate
	visible       bool
	raises        int
	opens         int
}

func (p *testPlatform) acquireMutex() (func(), error) {
	p.mutexHeld = true
	return func() { p.mutexHeld = false; p.mutexReleased++ }, nil
}
func (p *testPlatform) enumerate(config) ([]candidate, error) { return p.windows, nil }
func (p *testPlatform) reinforce(uintptr) bool                { p.raises++; return p.visible }
func (p *testPlatform) outputSize(uintptr) (uint32, uint32)   { return 1920, 1080 }
func (p *testPlatform) openRTSS() (*rtssClient, error) {
	p.opens++
	if p.client == nil {
		return nil, errors.New("absent")
	}
	return p.client, nil
}

type writeFunc func([]byte) (int, error)

func (f writeFunc) Write(b []byte) (int, error) { return f(b) }
func hookedPlatform() *testPlatform {
	c := rtssFixture(0x20014)
	h, _ := c.layout()
	put32(c.memory, int(h.appOffset), 42)
	put32(c.memory, int(h.appOffset)+264, 8)
	return &testPlatform{client: c, visible: true, windows: []candidate{{HWND: "0x100", PID: 42, Process: "bodycam.exe", Foreground: true, Fullscreen: true, Title: "Fixture only"}}}
}

const enableCommands = `{"type":"config","enabled":true,"mode":"auto","pollMs":60,"rtssVisualizer":true}` + "\n" + `{"type":"bind","overlayHwnd":"0x555"}` + "\n" + `{"type":"state","state":{"title":"Fixture song","playing":true,"duration":60,"currentTime":20}}` + "\n"

func TestOwnerReleasesRTSSSlotMappingAndMutexOnStopAndEOF(t *testing.T) {
	for _, stop := range []bool{true, false} {
		p := hookedPlatform()
		memory := p.client.memory
		h, _ := p.client.layout()
		other := p.client.entry(h, 1)
		writeString(other[256:512], "Untouched app")
		closed := 0
		p.client.closeMapping = func() { closed++ }
		r, w := io.Pipe()
		seen := false
		out := writeFunc(func(b []byte) (int, error) {
			var st hostStatus
			_ = json.Unmarshal(b, &st)
			if st.Type == "status" && st.Active && !seen {
				seen = true
				if st.Renderer != "rtss" || p.client.slot <= 1 || !strings.Contains(cstring(p.client.entry(h, p.client.slot)[512:4608]), "Fixture song") {
					t.Error("OSD/protocol feature missing")
				}
				if stop {
					_, _ = io.WriteString(w, "{\"type\":\"stop\"}\n")
				}
				_ = w.Close()
			}
			return len(b), nil
		})
		go func() { _, _ = io.WriteString(w, enableCommands) }()
		if err := runHost(context.Background(), r, out, io.Discard, p); err != nil {
			t.Fatal(err)
		}
		r.Close()
		w.Close()
		if !seen || closed != 1 || p.mutexHeld || p.mutexReleased != 1 || !p.client.closed {
			t.Fatal("incomplete cleanup")
		}
		if cstring(other[256:512]) != "Untouched app" {
			t.Fatal("foreign OSD removed")
		}
		if strings.Contains(string(memory), rtssOwner) {
			t.Fatal("own OSD slot leaked")
		}
	}
}
func TestOwnerOutputFailureAlsoReleasesAllResources(t *testing.T) {
	p := hookedPlatform()
	closed := 0
	p.client.closeMapping = func() { closed++ }
	r, w := io.Pipe()
	defer r.Close()
	defer w.Close()
	go func() { _, _ = io.WriteString(w, enableCommands) }()
	writes := 0
	out := writeFunc(func(b []byte) (int, error) {
		writes++
		if writes > 1 {
			return 0, io.ErrClosedPipe
		}
		return len(b), nil
	})
	if e := runHost(context.Background(), r, out, io.Discard, p); !errors.Is(e, io.ErrClosedPipe) {
		t.Fatalf("missing output failure: %v", e)
	}
	if closed != 1 || p.mutexHeld {
		t.Fatal("resources leaked on broken stdout")
	}
}
func TestBusyRTSSDoesNotBlockStatusOrRecovery(t *testing.T) {
	p := hookedPlatform()
	put32(p.client.memory, 36, 1)
	r, w := io.Pipe()
	defer r.Close()
	defer w.Close()
	busy, active := false, false
	go func() { _, _ = io.WriteString(w, enableCommands) }()
	out := writeFunc(func(b []byte) (int, error) {
		var st hostStatus
		json.Unmarshal(b, &st)
		if st.Type == "status" && !busy && st.Reason == "GameRTSSBusy" {
			busy = true
			put32(p.client.memory, 36, 0)
		}
		if st.Type == "status" && st.Active {
			active = true
			w.Close()
		}
		return len(b), nil
	})
	if e := runHost(context.Background(), r, out, io.Discard, p); e != nil {
		t.Fatal(e)
	}
	if !busy || !active {
		t.Fatal("busy mapping blocked status/recovery")
	}
}
func TestWindowFallbackRemainsAvailableWithoutRTSS(t *testing.T) {
	p := hookedPlatform()
	p.client = nil
	r, w := io.Pipe()
	defer r.Close()
	defer w.Close()
	seen := false
	go func() { _, _ = io.WriteString(w, enableCommands) }()
	out := writeFunc(func(b []byte) (int, error) {
		var st hostStatus
		json.Unmarshal(b, &st)
		if st.Type == "status" && st.Active {
			seen = st.Renderer == "window-fallback"
			w.Close()
		}
		return len(b), nil
	})
	if e := runHost(context.Background(), r, out, io.Discard, p); e != nil {
		t.Fatal(e)
	}
	if !seen || p.raises < 1 || p.mutexHeld {
		t.Fatal("window fallback lost")
	}
}
func TestBackendModeFullscreenAndAllowlistPolicies(t *testing.T) {
	p := hookedPlatform()
	fg := &p.windows[0]
	base := config{enabled: true, mode: "auto", overlay: 1, allowed: map[string]bool{"bodycam.exe": true}}
	cases := []struct {
		name   string
		change func(*config, *candidate, *rtssStatus)
		want   string
	}{
		{"auto fallback", func(*config, *candidate, *rtssStatus) {}, "window-fallback"},
		{"off", func(c *config, _ *candidate, _ *rtssStatus) { c.mode = "off" }, "none"},
		{"disabled", func(c *config, _ *candidate, _ *rtssStatus) { c.enabled = false }, "none"},
		{"Windows mode", func(c *config, _ *candidate, _ *rtssStatus) { c.mode = "window" }, "none"},
		{"RTSS no hook", func(c *config, _ *candidate, _ *rtssStatus) { c.mode = "rtss" }, "none"},
		{"RTSS hooked", func(c *config, _ *candidate, r *rtssStatus) { c.mode = "rtss"; r.Running = true; r.Hooked = true }, "rtss"},
		{"fullscreen filter", func(c *config, f *candidate, _ *rtssStatus) { c.onlyFullscreen = true; f.Fullscreen = false }, "none"},
		{"windowed allowed", func(c *config, f *candidate, _ *rtssStatus) { c.onlyFullscreen = false; f.Fullscreen = false }, "window-fallback"},
		{"allowlist match", func(c *config, _ *candidate, _ *rtssStatus) { c.allowlistOnly = true }, "window-fallback"},
		{"allowlist mismatch", func(c *config, f *candidate, _ *rtssStatus) { c.allowlistOnly = true; f.Process = "other.exe" }, "none"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := base
			f := *fg
			r := rtssStatus{}
			tc.change(&c, &f, &r)
			got, _ := decideBackend(c, &f, r)
			if got != tc.want {
				t.Fatalf("got %s want %s", got, tc.want)
			}
		})
	}
	if got, _ := decideBackend(base, nil, rtssStatus{}); got != "none" {
		t.Fatal("no game filter")
	}
}
func FuzzRTSSLayout(f *testing.F) {
	f.Add(rtssFixture(0x20014).memory)
	f.Add([]byte("bad header"))
	f.Add(make([]byte, 128))
	f.Fuzz(func(t *testing.T, b []byte) {
		if len(b) > 1024*1024 {
			return
		}
		copyOf := append([]byte(nil), b...)
		c := &rtssClient{memory: copyOf, slot: -1}
		_ = c.updateText("fixture")
		_, _ = c.status(12, 1920, 1080)
		_ = c.release()
	})
}
