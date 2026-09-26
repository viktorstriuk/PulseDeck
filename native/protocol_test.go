package main

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
)

func TestProtocolEOFAndStopReleaseOwner(t *testing.T) {
	for _, input := range []string{"", `{"type":"stop"}` + "\n" + `{"type":"state","state":{"title":"must not apply"}}` + "\n"} {
		m := newModel()
		stopped := false
		e := readCommands(context.Background(), strings.NewReader(input), m, func() { stopped = true })
		if e != nil || !stopped {
			t.Fatal("owner not notified")
		}
		_, s := m.snapshot()
		if s.State.Title != "" {
			t.Fatal("processed data after stop")
		}
	}
}
func TestProtocolBoundedAndInvalidJSON(t *testing.T) {
	m := newModel()
	var b bytes.Buffer
	b.WriteString("malformed\n")
	b.WriteString(`{"type":"not-a-command","state":{"title":"bad"}}` + "\n")
	for i := 0; i < 10000; i++ {
		json.NewEncoder(&b).Encode(command{Type: "audio", Freq: []float64{float64(i % 256)}})
	}
	if e := readCommands(context.Background(), &b, m, func() {}); e != nil {
		t.Fatal(e)
	}
	_, s := m.snapshot()
	if len(s.Freq) != 1 || s.Freq[0] != 15 {
		t.Fatal("audio not coalesced into latest snapshot")
	}
	if e := readCommands(context.Background(), strings.NewReader(strings.Repeat("x", maxCommandBytes+1)), m, func() {}); e == nil {
		t.Fatal("unbounded scanner")
	}
}
func TestProtocolConfigValidationAndSnapshots(t *testing.T) {
	m := newModel()
	m.apply(command{Type: "config", Enabled: true, Mode: "rtss", PollMs: 1, RTSSAnchor: "bottom-right", RTSSOffsetX: -10, RTSSOffsetY: 9999, Color1: "#ff00aa", Color2: "<C=bad>", AllowedGames: []string{`C:\Games\BODYCAM.EXE`}})
	m.apply(command{Type: "bind", OverlayHWND: "0xff", MainHWND: "123"})
	c, _ := m.snapshot()
	if c.mode != "rtss" || !c.enabled || c.overlay != 255 || c.main != 123 || c.pollMs != 60 || c.offsetX != 0 || c.offsetY != 500 || c.color1 != "FF00AA" || c.color2 != "4665c2" || !c.allowed["bodycam.exe"] {
		t.Fatalf("bad config: %+v", c)
	}
	c.allowed["bad.exe"] = true
	c2, _ := m.snapshot()
	if c2.allowed["bad.exe"] {
		t.Fatal("map alias")
	}
	m.apply(command{Type: "audio", Freq: make([]float64, 1000)})
	_, s := m.snapshot()
	if len(s.Freq) != 96 {
		t.Fatal("samples not bounded")
	}
	m.apply(command{Type: "state", State: mediaState{Playing: false, Title: strings.Repeat("я", 1000), CurrentTime: 500, Duration: 10}})
	_, s = m.snapshot()
	if len([]rune(s.State.Title)) != 256 || s.State.CurrentTime != 10 || len(s.Freq) != 0 {
		t.Fatal("state not bounded/paused spectrum retained")
	}
}
func TestConcurrentInputAndFrameSnapshots(t *testing.T) {
	m := newModel()
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 0; n < 2000; n++ {
				m.apply(command{Type: "audio", Freq: []float64{12, 200}})
				m.snapshot()
			}
		}()
	}
	wg.Wait()
}
func TestOSDTextSanitizesTagsAndKeepsFeatures(t *testing.T) {
	m := newModel()
	c, _ := m.snapshot()
	c.anchor = "bottom-right"
	c.offsetX = 0
	s := mediaSnapshot{State: mediaState{Title: "Song <P=0,0>\nTitle", Artist: "Исполнитель", Playlist: "Избранное", Playing: true, CurrentTime: 30, Duration: 120}, Freq: []float64{255, 50, 150}}
	text := buildRTSSOSD(c, s, 0x20014)
	for _, want := range []string{"<P=-1,-24>", "(P=0,0)", "Исполнитель", "Избранное", "0:30 / 2:00", "<C0=", "<C1="} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q in %q", want, text)
		}
	}
	if strings.Contains(text, "<P=0,0>") {
		t.Fatal("unescaped track tag")
	}
	if len(strings.Split(text, "\n")) != 4 {
		t.Fatal("spectrum missing")
	}
	s.State.Playing = false
	if len(strings.Split(buildRTSSOSD(c, s, 0x20014), "\n")) != 3 {
		t.Fatal("paused spectrum visible")
	}
}

func TestOlderRTSSGetsPlainTextWithoutUnsupportedTags(t *testing.T) {
	m := newModel()
	c, s := m.snapshot()
	s.State.Title = "Legacy"
	s.State.Playing = true
	text := buildRTSSOSD(c, s, 0x20000)
	if strings.Contains(text, "<C") || strings.Contains(text, "<P") {
		t.Fatal("unsupported RTSS formatting")
	}
	if !strings.Contains(text, "Legacy") || strings.Contains(text, "Music") {
		t.Fatal("legacy text missing")
	}
}
