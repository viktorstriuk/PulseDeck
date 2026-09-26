package main

import (
	"fmt"
	"sort"
	"sync"
)

type candidate struct {
	HWND       string `json:"hwnd"`
	PID        uint32 `json:"pid"`
	Process    string `json:"process"`
	Path       string `json:"path,omitempty"`
	Title      string `json:"title"`
	Class      string `json:"class,omitempty"`
	Fullscreen bool   `json:"fullscreen"`
	Foreground bool   `json:"foreground"`
	Width      int32  `json:"width"`
	Height     int32  `json:"height"`
}

type enumContext struct {
	config config
	items  []candidate
}

// The callback function value and its Windows thunk are registered ONCE. Only
// an integer request token crosses Win32; per-call state stays GC-rooted here.
// No Go pointer is stored by Windows, and every context is removed on return.
// enumMu also ensures a late callback cannot append to an old returned slice.
// Windows EnumWindows is synchronous on the enumerating thread.
type windowEnumerator struct {
	once     sync.Once
	enumMu   sync.Mutex
	mu       sync.Mutex
	callback uintptr
	token    uintptr
	contexts map[uintptr]*enumContext
	register func(func(uintptr, uintptr) uintptr) uintptr
	invoke   func(uintptr, uintptr) error
	inspect  func(uintptr, config) (candidate, bool)
}

func (e *windowEnumerator) visit(h, token uintptr) uintptr {
	e.mu.Lock()
	defer e.mu.Unlock()
	c := e.contexts[token]
	if c == nil {
		return 1
	}
	if item, ok := e.inspect(h, c.config); ok && (item.Fullscreen || item.Foreground) {
		c.items = append(c.items, item)
	}
	return 1
}

func (e *windowEnumerator) enumerate(c config) ([]candidate, error) {
	e.enumMu.Lock()
	defer e.enumMu.Unlock()
	e.once.Do(func() { e.callback = e.register(e.visit) })
	if e.callback == 0 {
		return nil, fmt.Errorf("EnumWindows callback registration failed")
	}
	e.mu.Lock()
	if e.contexts == nil {
		e.contexts = map[uintptr]*enumContext{}
	}
	e.token++
	if e.token == 0 {
		e.token++
	}
	token := e.token
	state := &enumContext{config: c, items: make([]candidate, 0, 8)}
	e.contexts[token] = state
	e.mu.Unlock()
	defer func() { e.mu.Lock(); delete(e.contexts, token); e.mu.Unlock() }()
	if err := e.invoke(e.callback, token); err != nil {
		return nil, err
	}
	e.mu.Lock()
	out := append([]candidate{}, state.items...)
	e.mu.Unlock()
	score := func(x candidate) int {
		s := 0
		if x.Foreground {
			s += 4
		}
		if x.Fullscreen {
			s += 2
		}
		return s
	}
	sort.SliceStable(out, func(i, j int) bool { return score(out[i]) > score(out[j]) })
	if len(out) > 8 {
		out = out[:8]
	}
	return out, nil
}

func allowedGame(c config, item *candidate) bool {
	return item != nil && (!c.allowlistOnly || c.allowed[processName(item.Process)])
}
