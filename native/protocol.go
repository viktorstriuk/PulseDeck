package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strconv"
	"strings"
	"sync"
)

const hostVersion = "2.9.3-beta.2"
const maxCommandBytes = 1024 * 1024

type command struct {
	Type           string     `json:"type"`
	OverlayHWND    string     `json:"overlayHwnd"`
	MainHWND       string     `json:"mainHwnd"`
	Enabled        bool       `json:"enabled"`
	Mode           string     `json:"mode"`
	OnlyFullscreen bool       `json:"onlyFullscreen"`
	AllowlistOnly  bool       `json:"allowlistOnly"`
	AllowedGames   []string   `json:"allowedGames"`
	PollMs         int        `json:"pollMs"`
	RTSSVisualizer bool       `json:"rtssVisualizer"`
	RTSSAnchor     string     `json:"rtssAnchor"`
	RTSSOffsetX    int        `json:"rtssOffsetX"`
	RTSSOffsetY    int        `json:"rtssOffsetY"`
	Color1         string     `json:"color1"`
	Color2         string     `json:"color2"`
	State          mediaState `json:"state"`
	Freq           []float64  `json:"freq"`
	Wave           []float64  `json:"wave"`
}

type config struct {
	overlay, main                 uintptr
	enabled                       bool
	mode                          string
	onlyFullscreen, allowlistOnly bool
	allowed                       map[string]bool
	pollMs                        int
	visualizer                    bool
	anchor                        string
	offsetX, offsetY              int
	color1, color2                string
}

type mediaState struct {
	Title       string  `json:"title"`
	Artist      string  `json:"artist"`
	Playlist    string  `json:"playlist"`
	CurrentTime float64 `json:"currentTime"`
	Duration    float64 `json:"duration"`
	Playing     bool    `json:"playing"`
}

type mediaSnapshot struct {
	State mediaState
	Freq  []float64
}

type model struct {
	mu     sync.RWMutex
	config config
	media  mediaSnapshot
}

func newModel() *model {
	return &model{config: config{mode: "auto", onlyFullscreen: true, pollMs: 120, allowed: map[string]bool{}, visualizer: true, anchor: "top-left", offsetX: 24, offsetY: 24, color1: "b038ae", color2: "4665c2"}}
}

func bounded(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
func nonnegative(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
		return 0
	}
	return math.Min(v, 1e9)
}
func limited(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		r = r[:n]
	}
	return string(r)
}
func processName(s string) string {
	s = strings.ReplaceAll(strings.TrimSpace(s), "\\", "/")
	at := strings.LastIndex(s, "/")
	return strings.ToLower(s[at+1:])
}
func parseHWND(s string) uintptr {
	s = strings.TrimSpace(s)
	base := 10
	if strings.HasPrefix(strings.ToLower(s), "0x") {
		base = 16
		s = s[2:]
	}
	v, e := strconv.ParseUint(s, base, 64)
	if e != nil {
		return 0
	}
	return uintptr(v)
}

func (m *model) apply(cmd command) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := &m.config
	switch cmd.Type {
	case "bind":
		c.overlay = parseHWND(cmd.OverlayHWND)
		c.main = parseHWND(cmd.MainHWND)
	case "config":
		c.enabled = cmd.Enabled
		c.mode = cmd.Mode
		if c.mode != "auto" && c.mode != "rtss" && c.mode != "window" && c.mode != "off" {
			c.mode = "auto"
		}
		c.onlyFullscreen = cmd.OnlyFullscreen
		c.allowlistOnly = cmd.AllowlistOnly
		c.allowed = map[string]bool{}
		for i, g := range cmd.AllowedGames {
			if i >= 80 {
				break
			}
			p := processName(g)
			if p != "" {
				c.allowed[p] = true
			}
		}
		c.pollMs = bounded(cmd.PollMs, 60, 500)
		c.visualizer = cmd.RTSSVisualizer
		c.anchor = cmd.RTSSAnchor
		if c.anchor != "top-right" && c.anchor != "bottom-left" && c.anchor != "bottom-right" {
			c.anchor = "top-left"
		}
		c.offsetX = bounded(cmd.RTSSOffsetX, 0, 500)
		c.offsetY = bounded(cmd.RTSSOffsetY, 0, 500)
		c.color1 = parseColor(cmd.Color1, "b038ae")
		c.color2 = parseColor(cmd.Color2, "4665c2")
	case "state":
		s := cmd.State
		s.Title = limited(s.Title, 256)
		s.Artist = limited(s.Artist, 256)
		s.Playlist = limited(s.Playlist, 256)
		s.CurrentTime = nonnegative(s.CurrentTime)
		s.Duration = nonnegative(s.Duration)
		if s.Duration > 0 {
			s.CurrentTime = math.Min(s.CurrentTime, s.Duration)
		}
		m.media.State = s
		if !s.Playing {
			m.media.Freq = nil
		}
	case "visual":
		c.color1 = parseColor(cmd.Color1, c.color1)
		c.color2 = parseColor(cmd.Color2, c.color2)
	case "audio":
		n := len(cmd.Freq)
		if n > 96 {
			n = 96
		}
		f := make([]float64, n)
		for i := range f {
			f[i] = math.Min(nonnegative(cmd.Freq[i]), 255)
		}
		m.media.Freq = f
	}
}

func (m *model) snapshot() (config, mediaSnapshot) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	c := m.config
	c.allowed = make(map[string]bool, len(m.config.allowed))
	for k, v := range m.config.allowed {
		c.allowed[k] = v
	}
	media := m.media
	media.Freq = append([]float64(nil), media.Freq...)
	return c, media
}

// No unbounded command channel: apply() replaces the current snapshot. EOF and
// stop cancel the owner loop; it releases shared memory and the OS mutex before
// returning. In particular, never os.Exit() from this reader goroutine.
func readCommands(ctx context.Context, r io.Reader, m *model, stop context.CancelFunc) error {
	defer stop()
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 4096), maxCommandBytes)
	for sc.Scan() {
		if ctx.Err() != nil {
			return nil
		}
		var cmd command
		if json.Unmarshal(sc.Bytes(), &cmd) != nil {
			continue
		}
		if cmd.Type == "stop" {
			return nil
		}
		m.apply(cmd)
	}
	if e := sc.Err(); e != nil && !errors.Is(e, io.EOF) {
		return e
	}
	return nil
}
