package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"
)

type hostPlatform interface {
	acquireMutex() (func(), error)
	enumerate(config) ([]candidate, error)
	reinforce(uintptr) bool
	outputSize(uintptr) (uint32, uint32)
	openRTSS() (*rtssClient, error)
}

type hostStatus struct {
	Type       string      `json:"type"`
	Supported  bool        `json:"supported"`
	Running    bool        `json:"running"`
	Active     bool        `json:"active"`
	Renderer   string      `json:"renderer"`
	Reason     string      `json:"reasonKey"`
	Foreground *candidate  `json:"foreground"`
	Candidates []candidate `json:"candidates"`
	RTSS       rtssStatus  `json:"rtss"`
	Timestamp  int64       `json:"timestamp"`
}

func decideBackend(c config, fg *candidate, r rtssStatus) (string, string) {
	if !c.enabled || c.mode == "off" {
		return "none", "AppGameOverlayDisabled"
	}
	if c.mode == "window" {
		return "none", "AppUsingARegularWindowsWindow"
	}
	if fg == nil {
		return "none", "GameNotDetected"
	}
	if c.onlyFullscreen && !fg.Fullscreen {
		return "none", "GameNotFullscreen"
	}
	if !allowedGame(c, fg) {
		return "none", "GameNotAllowed"
	}
	if r.Running && r.Hooked {
		return "rtss", "UIRTSSIsRenderingPulseDeckInsideTheGame"
	}
	if c.mode == "rtss" {
		return "none", "GameAwaitingRTSS"
	}
	if c.overlay == 0 {
		return "none", "GameWindowMissing"
	}
	return "window-fallback", "GameWindowFallback"
}

func runHost(parent context.Context, input io.Reader, output, diagnostic io.Writer, p hostPlatform) error {
	releaseMutex, err := p.acquireMutex()
	if err != nil {
		return err
	}
	defer releaseMutex()
	ctx, cancel := context.WithCancel(parent)
	defer cancel()
	m := newModel()
	enc := json.NewEncoder(output)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(map[string]any{"type": "hello", "supported": true, "running": true, "pid": os.Getpid(), "version": hostVersion, "backends": []string{"rtss", "window"}}); err != nil {
		return err
	}
	readDone := make(chan error, 1)
	go func() { e := readCommands(ctx, input, m, func() {}); readDone <- e; cancel() }()
	var rtss *rtssClient
	defer func() {
		if rtss != nil {
			// Give another OSD client a short opportunity to release dwBusy; then
			// unmap regardless. No indefinite shutdown wait and no raw metadata log.
			for i := 0; i < 10; i++ {
				if e := rtss.release(); !errors.Is(e, errBusy) {
					break
				}
				time.Sleep(time.Millisecond)
			}
			rtss.close()
		}
	}()
	ticker := time.NewTicker(33 * time.Millisecond)
	defer ticker.Stop()
	var lastPoll, lastRTSSAttempt, lastEmit time.Time
	var candidates []candidate
	var fg *candidate
	var ow, oh uint32
	var lastRS rtssStatus
	lastKey := ""
	for {
		select {
		case <-ctx.Done():
			select {
			case e := <-readDone:
				if e != nil {
					fmt.Fprintln(diagnostic, "overlay-host: input protocol error")
				}
				return e
			default:
				return nil
			}
		case now := <-ticker.C:
			c, media := m.snapshot()
			if now.Sub(lastPoll) >= time.Duration(c.pollMs)*time.Millisecond {
				items, e := p.enumerate(c)
				if e == nil {
					candidates = items
				} else {
					candidates = []candidate{}
				}
				fg = nil
				for i := range candidates {
					if candidates[i].Foreground {
						fg = &candidates[i]
						break
					}
				}
				if fg == nil && len(candidates) > 0 {
					fg = &candidates[0]
				}
				ow, oh = 0, 0
				if fg != nil {
					ow, oh = p.outputSize(parseHWND(fg.HWND))
				}
				lastPoll = now
			}
			if rtss == nil && now.Sub(lastRTSSAttempt) >= time.Second {
				rtss, _ = p.openRTSS()
				lastRTSSAttempt = now
			}
			rs := rtssStatus{AspectScaleX: 1, OutputWidth: ow, OutputHeight: oh}
			rtssBusy := false
			pid := uint32(0)
			if fg != nil {
				pid = fg.PID
			}
			if rtss != nil {
				var e error
				rs, e = rtss.status(pid, ow, oh)
				if errors.Is(e, errBusy) {
					rtssBusy = true
					rs = lastRS
					rs.Running = true
					e = nil
				}
				if e != nil {
					rtss.close()
					rtss = nil
					rs = rtssStatus{AspectScaleX: 1}
				}
			}
			if !rtssBusy {
				lastRS = rs
			}
			backend, reason := decideBackend(c, fg, rs)
			if rtssBusy {
				backend = "none"
				reason = "GameRTSSBusy"
			}
			active := false
			if backend == "rtss" && rtss != nil {
				if e := rtss.updateText(buildRTSSOSD(c, media, rs.sharedVersion)); e == nil {
					active = true
				} else if !errors.Is(e, errBusy) {
					backend = "none"
					reason = "GameRTSSUpdateFailed"
				}
			} else {
				if rtss != nil && !rtssBusy {
					_ = rtss.release()
				}
				if backend == "window-fallback" {
					active = p.reinforce(c.overlay)
					if !active {
						backend = "none"
						reason = "GameWindowHidden"
					}
				}
			}
			if candidates == nil {
				candidates = []candidate{}
			}
			st := hostStatus{Type: "status", Supported: true, Running: true, Active: active, Renderer: backend, Reason: reason, Foreground: fg, Candidates: candidates, RTSS: rs}
			keyBytes, _ := json.Marshal(st)
			key := string(keyBytes)
			if key != lastKey || now.Sub(lastEmit) >= 3*time.Second {
				st.Timestamp = now.UnixMilli()
				if e := enc.Encode(st); e != nil {
					return e
				}
				lastKey = key
				lastEmit = now
			}
		}
	}
}

func main() {
	if err := runHost(context.Background(), os.Stdin, os.Stdout, os.Stderr, newPlatform()); err != nil {
		// No stack or command dump: music titles and paths can be private. Parent
		// records the exit code and handles failure without touching playback.
		fmt.Fprintln(os.Stderr, "OVERLAY_HOST_IO_OR_INIT_ERROR")
		os.Exit(2)
	}
}
