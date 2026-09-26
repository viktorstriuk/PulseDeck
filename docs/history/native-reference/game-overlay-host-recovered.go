//go:build windows

// PulseDeck Game Overlay Host
//
// A small native Win32 companion used to reinforce the Electron player window
// above borderless/fullscreen-optimized games. It does not inject code into
// other processes and does not hook graphics APIs. Commands arrive as JSON
// lines on stdin and status updates are emitted as JSON lines on stdout.
package main

import (
    "bufio"
    "encoding/json"
    "fmt"
    "os"
    "path/filepath"
    "strconv"
    "strings"
    "sync"
    "syscall"
    "time"
    "unsafe"
)

type rect struct{ Left, Top, Right, Bottom int32 }
type monitorInfo struct {
    CbSize uint32
    RcMonitor rect
    RcWork rect
    DwFlags uint32
}

type command struct {
    Type          string   `json:"type"`
    OverlayHWND   string   `json:"overlayHwnd"`
    MainHWND      string   `json:"mainHwnd"`
    Enabled       bool     `json:"enabled"`
    Mode          string   `json:"mode"`
    OnlyFullscreen bool    `json:"onlyFullscreen"`
    AllowlistOnly bool     `json:"allowlistOnly"`
    AllowedGames  []string `json:"allowedGames"`
    PollMs        int      `json:"pollMs"`
}

type config struct {
    overlay uintptr
    main uintptr
    enabled bool
    mode string
    onlyFullscreen bool
    allowlistOnly bool
    allowed map[string]bool
    pollMs int
}

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

type status struct {
    Type        string      `json:"type"`
    Supported   bool        `json:"supported"`
    Running     bool        `json:"running"`
    Active      bool        `json:"active"`
    Reason      string      `json:"reason"`
    Foreground  *candidate  `json:"foreground,omitempty"`
    Candidates  []candidate `json:"candidates,omitempty"`
    Timestamp   int64       `json:"timestamp"`
}

var (
    user32   = syscall.NewLazyDLL("user32.dll")
    kernel32 = syscall.NewLazyDLL("kernel32.dll")
    dwmapi   = syscall.NewLazyDLL("dwmapi.dll")

    pGetForegroundWindow = user32.NewProc("GetForegroundWindow")
    pGetWindowRect       = user32.NewProc("GetWindowRect")
    pGetWindowTextLengthW = user32.NewProc("GetWindowTextLengthW")
    pGetWindowTextW      = user32.NewProc("GetWindowTextW")
    pGetClassNameW       = user32.NewProc("GetClassNameW")
    pGetWindowThreadProcessId = user32.NewProc("GetWindowThreadProcessId")
    pIsWindowVisible     = user32.NewProc("IsWindowVisible")
    pIsWindow            = user32.NewProc("IsWindow")
    pGetWindow           = user32.NewProc("GetWindow")
    pEnumWindows         = user32.NewProc("EnumWindows")
    pMonitorFromWindow   = user32.NewProc("MonitorFromWindow")
    pGetMonitorInfoW     = user32.NewProc("GetMonitorInfoW")
    pSetWindowPos        = user32.NewProc("SetWindowPos")
    pShowWindow          = user32.NewProc("ShowWindow")

    pOpenProcess         = kernel32.NewProc("OpenProcess")
    pCreateMutexW        = kernel32.NewProc("CreateMutexW")
    pQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
    pCloseHandle         = kernel32.NewProc("CloseHandle")
    pDwmGetWindowAttribute = dwmapi.NewProc("DwmGetWindowAttribute")
)

const (
    monitorDefaultNearest = 2
    processQueryLimitedInformation = 0x1000
    gwOwner = 4
    swShownoactivate = 4
    swpNoSize = 0x0001
    swpNoMove = 0x0002
    swpNoActivate = 0x0010
    swpShowWindow = 0x0040
    dwmwaExtendedFrameBounds = 9
)

var hwndTopmost = ^uintptr(0) // (HWND)-1

var cfgMu sync.RWMutex
var cfg = config{mode: "auto", onlyFullscreen: true, allowed: map[string]bool{}, pollMs: 120}
var outMu sync.Mutex

func parseHWND(s string) uintptr {
    s = strings.TrimSpace(s)
    if s == "" || s == "0" { return 0 }
    base := 10
    if strings.HasPrefix(strings.ToLower(s), "0x") { base = 16; s = s[2:] }
    v, err := strconv.ParseUint(s, base, 64)
    if err != nil { return 0 }
    return uintptr(v)
}

func hwndString(h uintptr) string { return fmt.Sprintf("0x%x", h) }

func emit(v any) {
    b, _ := json.Marshal(v)
    outMu.Lock()
    defer outMu.Unlock()
    fmt.Println(string(b))
}

func getWindowRect(h uintptr) (rect, bool) {
    var r rect
    if h == 0 { return r, false }
    ok, _, _ := pDwmGetWindowAttribute.Call(h, dwmwaExtendedFrameBounds, uintptr(unsafe.Pointer(&r)), unsafe.Sizeof(r))
    if int32(ok) == 0 && r.Right > r.Left && r.Bottom > r.Top { return r, true }
    ret, _, _ := pGetWindowRect.Call(h, uintptr(unsafe.Pointer(&r)))
    return r, ret != 0 && r.Right > r.Left && r.Bottom > r.Top
}

func monitorRectFor(h uintptr) (rect, bool) {
    mon, _, _ := pMonitorFromWindow.Call(h, monitorDefaultNearest)
    if mon == 0 { return rect{}, false }
    mi := monitorInfo{CbSize: uint32(unsafe.Sizeof(monitorInfo{}))}
    ret, _, _ := pGetMonitorInfoW.Call(mon, uintptr(unsafe.Pointer(&mi)))
    return mi.RcMonitor, ret != 0
}

func windowText(h uintptr) string {
    n, _, _ := pGetWindowTextLengthW.Call(h)
    if n == 0 { return "" }
    buf := make([]uint16, int(n)+2)
    got, _, _ := pGetWindowTextW.Call(h, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
    if got == 0 { return "" }
    return syscall.UTF16ToString(buf[:got])
}

func className(h uintptr) string {
    buf := make([]uint16, 256)
    got, _, _ := pGetClassNameW.Call(h, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
    if got == 0 { return "" }
    return syscall.UTF16ToString(buf[:got])
}

func processInfo(h uintptr) (uint32, string, string) {
    var pid uint32
    pGetWindowThreadProcessId.Call(h, uintptr(unsafe.Pointer(&pid)))
    if pid == 0 { return 0, "", "" }
    ph, _, _ := pOpenProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
    if ph == 0 { return pid, "", "" }
    defer pCloseHandle.Call(ph)
    buf := make([]uint16, 32768)
    size := uint32(len(buf))
    ret, _, _ := pQueryFullProcessImageNameW.Call(ph, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
    if ret == 0 || size == 0 { return pid, "", "" }
    full := syscall.UTF16ToString(buf[:size])
    return pid, strings.ToLower(filepath.Base(full)), full
}

func isFullscreenWindow(h uintptr, r rect) bool {
    mr, ok := monitorRectFor(h)
    if !ok { return false }
    const tol int32 = 6
    return r.Left <= mr.Left+tol && r.Top <= mr.Top+tol && r.Right >= mr.Right-tol && r.Bottom >= mr.Bottom-tol
}

func isCandidateWindow(h uintptr, c config) (candidate, bool) {
    if h == 0 || h == c.overlay || h == c.main { return candidate{}, false }
    vis, _, _ := pIsWindowVisible.Call(h)
    if vis == 0 { return candidate{}, false }
    owner, _, _ := pGetWindow.Call(h, gwOwner)
    if owner != 0 { return candidate{}, false }
    r, ok := getWindowRect(h)
    if !ok { return candidate{}, false }
    w, hh := r.Right-r.Left, r.Bottom-r.Top
    if w < 480 || hh < 320 { return candidate{}, false }
    title := strings.TrimSpace(windowText(h))
    if title == "" { return candidate{}, false }
    pid, proc, full := processInfo(h)
    if proc == "" { proc = "unknown.exe" }
    if proc == "explorer.exe" || proc == "shellexperiencehost.exe" || proc == "searchhost.exe" || proc == "textinputhost.exe" { return candidate{}, false }
    fg, _, _ := pGetForegroundWindow.Call()
    out := candidate{HWND: hwndString(h), PID: pid, Process: proc, Path: full, Title: title, Class: className(h), Fullscreen: isFullscreenWindow(h, r), Foreground: h == fg, Width: w, Height: hh}
    return out, true
}

func enumerateCandidates(c config) []candidate {
    out := make([]candidate, 0, 8)
    cb := syscall.NewCallback(func(h uintptr, lparam uintptr) uintptr {
        if item, ok := isCandidateWindow(h, c); ok {
            if item.Fullscreen || item.Foreground { out = append(out, item) }
        }
        return 1
    })
    pEnumWindows.Call(cb, 0)
    // Foreground and fullscreen candidates first.
    for i := 0; i < len(out); i++ {
        for j := i + 1; j < len(out); j++ {
            score := func(x candidate) int { s:=0; if x.Foreground { s+=4 }; if x.Fullscreen { s+=2 }; return s }
            if score(out[j]) > score(out[i]) { out[i], out[j] = out[j], out[i] }
        }
    }
    if len(out) > 8 { out = out[:8] }
    return out
}

func allowGame(c config, item *candidate) bool {
    if item == nil { return false }
    if !c.allowlistOnly { return true }
    return c.allowed[strings.ToLower(item.Process)]
}

func reinforceOverlay(h uintptr) bool {
    if h == 0 { return false }
    ok, _, _ := pIsWindow.Call(h)
    if ok == 0 { return false }
    pShowWindow.Call(h, swShownoactivate)
    ret, _, _ := pSetWindowPos.Call(h, hwndTopmost, 0, 0, 0, 0, swpNoMove|swpNoSize|swpNoActivate|swpShowWindow)
    return ret != 0
}

func snapshot() config {
    cfgMu.RLock(); defer cfgMu.RUnlock()
    c := cfg
    c.allowed = make(map[string]bool, len(cfg.allowed))
    for k,v := range cfg.allowed { c.allowed[k]=v }
    return c
}

func applyCommand(cmd command) {
    cfgMu.Lock()
    defer cfgMu.Unlock()
    switch strings.ToLower(cmd.Type) {
    case "bind":
        cfg.overlay = parseHWND(cmd.OverlayHWND)
        cfg.main = parseHWND(cmd.MainHWND)
    case "config":
        cfg.enabled = cmd.Enabled
        mode := strings.ToLower(strings.TrimSpace(cmd.Mode))
        if mode != "auto" && mode != "native" && mode != "window" && mode != "off" { mode = "auto" }
        cfg.mode = mode
        cfg.onlyFullscreen = cmd.OnlyFullscreen
        cfg.allowlistOnly = cmd.AllowlistOnly
        cfg.allowed = map[string]bool{}
        for _, g := range cmd.AllowedGames {
            g = strings.ToLower(strings.TrimSpace(filepath.Base(g)))
            if g != "" { cfg.allowed[g] = true }
        }
        if cmd.PollMs >= 50 && cmd.PollMs <= 1000 { cfg.pollMs = cmd.PollMs }
    case "stop":
        os.Exit(0)
    }
}

func statusKey(s status) string {
    b,_:=json.Marshal(struct{Active bool;Reason string;Foreground *candidate;Candidates []candidate}{s.Active,s.Reason,s.Foreground,s.Candidates})
    return string(b)
}

func main() {
    mutexName, _ := syscall.UTF16PtrFromString(`Local\PulseDeck.GameOverlayHost`)
    mh, _, mutexErr := pCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(mutexName)))
    if mh == 0 { os.Exit(2) }
    if errno, ok := mutexErr.(syscall.Errno); ok && errno == syscall.Errno(183) { pCloseHandle.Call(mh); os.Exit(0) }
    defer pCloseHandle.Call(mh)

    emit(map[string]any{"type":"hello","supported":true,"running":true,"pid":os.Getpid(),"version":"1.0.0"})

    go func(){
        sc := bufio.NewScanner(os.Stdin)
        sc.Buffer(make([]byte,1024),1024*1024)
        for sc.Scan(){
            line:=strings.TrimSpace(sc.Text()); if line==""{continue}
            var cmd command
            if json.Unmarshal([]byte(line), &cmd)==nil { applyCommand(cmd) }
        }
        os.Exit(0)
    }()

    lastKey := ""
    lastEmit := time.Time{}
    for {
        c := snapshot()
        candidates := enumerateCandidates(c)
        var fg *candidate
        for i := range candidates { if candidates[i].Foreground { fg = &candidates[i]; break } }
        if fg == nil && len(candidates)>0 { fg=&candidates[0] }

        active := false
        reason := "Ожидание полноэкранного приложения"
        if !c.enabled || c.mode == "off" {
            reason = "Игровой оверлей выключен"
        } else if c.mode == "window" {
            reason = "Используется обычное окно Windows"
        } else if c.overlay == 0 {
            reason = "Окно проигрывателя ещё не создано"
        } else if fg == nil {
            reason = "Игра не обнаружена"
        } else if c.onlyFullscreen && !fg.Fullscreen {
            reason = "Приложение не в полноэкранном режиме"
        } else if !allowGame(c, fg) {
            reason = "Игра не входит в разрешённый список"
        } else {
            active = reinforceOverlay(c.overlay)
            if active { reason = "Нативный слой удерживает проигрыватель поверх игры" } else { reason = "Не удалось поднять окно проигрывателя" }
        }

        st := status{Type:"status", Supported:true, Running:true, Active:active, Reason:reason, Foreground:fg, Candidates:candidates, Timestamp:time.Now().UnixMilli()}
        key := statusKey(st)
        if key != lastKey || time.Since(lastEmit) > 4*time.Second {
            emit(st); lastKey=key; lastEmit=time.Now()
        }
        delay:=c.pollMs; if delay<50 {delay=120}
        time.Sleep(time.Duration(delay)*time.Millisecond)
    }
}
