//go:build windows

package main

import (
	"errors"
	"fmt"
	"strings"
	"syscall"
	"unsafe"
)

type rect struct{ Left, Top, Right, Bottom int32 }
type monitorInfo struct {
	Size          uint32
	Monitor, Work rect
	Flags         uint32
}
type memoryBasicInformation struct {
	BaseAddress, AllocationBase uintptr
	AllocationProtect           uint32
	PartitionID                 uint16
	Alignment                   uint16
	RegionSize                  uintptr
	State, Protect, Type        uint32
	Padding                     uint32
}

var (
	user32                      = syscall.NewLazyDLL("user32.dll")
	kernel32                    = syscall.NewLazyDLL("kernel32.dll")
	dwmapi                      = syscall.NewLazyDLL("dwmapi.dll")
	pEnumWindows                = user32.NewProc("EnumWindows")
	pGetForegroundWindow        = user32.NewProc("GetForegroundWindow")
	pGetWindowRect              = user32.NewProc("GetWindowRect")
	pGetWindowTextLengthW       = user32.NewProc("GetWindowTextLengthW")
	pGetWindowTextW             = user32.NewProc("GetWindowTextW")
	pGetClassNameW              = user32.NewProc("GetClassNameW")
	pGetWindowThreadProcessID   = user32.NewProc("GetWindowThreadProcessId")
	pIsWindowVisible            = user32.NewProc("IsWindowVisible")
	pIsWindow                   = user32.NewProc("IsWindow")
	pGetWindow                  = user32.NewProc("GetWindow")
	pMonitorFromWindow          = user32.NewProc("MonitorFromWindow")
	pGetMonitorInfoW            = user32.NewProc("GetMonitorInfoW")
	pSetWindowPos               = user32.NewProc("SetWindowPos")
	pDwmGetWindowAttribute      = dwmapi.NewProc("DwmGetWindowAttribute")
	pOpenProcess                = kernel32.NewProc("OpenProcess")
	pQueryFullProcessImageNameW = kernel32.NewProc("QueryFullProcessImageNameW")
	pCreateMutexW               = kernel32.NewProc("CreateMutexW")
	pCloseHandle                = kernel32.NewProc("CloseHandle")
	pOpenFileMappingW           = kernel32.NewProc("OpenFileMappingW")
	pMapViewOfFile              = kernel32.NewProc("MapViewOfFile")
	pUnmapViewOfFile            = kernel32.NewProc("UnmapViewOfFile")
	pVirtualQuery               = kernel32.NewProc("VirtualQuery")
)

type windowsPlatform struct{ enumerator windowEnumerator }

func newPlatform() hostPlatform {
	p := &windowsPlatform{}
	p.enumerator = windowEnumerator{
		register: func(callback func(uintptr, uintptr) uintptr) uintptr { return syscall.NewCallback(callback) },
		invoke: func(callback, token uintptr) error {
			ok, _, err := pEnumWindows.Call(callback, token)
			if ok == 0 {
				return fmt.Errorf("EnumWindows: %v", err)
			}
			return nil
		},
		inspect: inspectWindow,
	}
	return p
}
func (p *windowsPlatform) enumerate(c config) ([]candidate, error) { return p.enumerator.enumerate(c) }
func (p *windowsPlatform) acquireMutex() (func(), error) {
	name, _ := syscall.UTF16PtrFromString(`Local\PulseDeck.GameOverlayHost`)
	handle, _, e := pCreateMutexW.Call(0, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return nil, fmt.Errorf("CreateMutex: %v", e)
	}
	if e == syscall.Errno(183) {
		pCloseHandle.Call(handle)
		return nil, errors.New("overlay helper already running")
	}
	return func() { pCloseHandle.Call(handle) }, nil
}
func windowRect(h uintptr) (rect, bool) {
	var r rect
	if h == 0 {
		return r, false
	}
	if pDwmGetWindowAttribute.Find() == nil {
		hr, _, _ := pDwmGetWindowAttribute.Call(h, 9, uintptr(unsafe.Pointer(&r)), unsafe.Sizeof(r))
		if int32(hr) == 0 && r.Right > r.Left && r.Bottom > r.Top {
			return r, true
		}
	}
	ok, _, _ := pGetWindowRect.Call(h, uintptr(unsafe.Pointer(&r)))
	return r, ok != 0 && r.Right > r.Left && r.Bottom > r.Top
}
func monitorRect(h uintptr) (rect, bool) {
	mon, _, _ := pMonitorFromWindow.Call(h, 2)
	if mon == 0 {
		return rect{}, false
	}
	mi := monitorInfo{Size: uint32(unsafe.Sizeof(monitorInfo{}))}
	ok, _, _ := pGetMonitorInfoW.Call(mon, uintptr(unsafe.Pointer(&mi)))
	return mi.Monitor, ok != 0
}
func (p *windowsPlatform) outputSize(h uintptr) (uint32, uint32) {
	r, ok := monitorRect(h)
	if !ok || r.Right <= r.Left || r.Bottom <= r.Top {
		return 0, 0
	}
	return uint32(r.Right - r.Left), uint32(r.Bottom - r.Top)
}
func windowText(h uintptr) string {
	n, _, _ := pGetWindowTextLengthW.Call(h)
	if n == 0 {
		return ""
	}
	if n > 4096 {
		n = 4096
	}
	b := make([]uint16, int(n)+2)
	got, _, _ := pGetWindowTextW.Call(h, uintptr(unsafe.Pointer(&b[0])), uintptr(len(b)))
	if got >= uintptr(len(b)) {
		got = uintptr(len(b) - 1)
	}
	return syscall.UTF16ToString(b[:got])
}
func className(h uintptr) string {
	b := make([]uint16, 256)
	n, _, _ := pGetClassNameW.Call(h, uintptr(unsafe.Pointer(&b[0])), uintptr(len(b)))
	if n >= uintptr(len(b)) {
		n = uintptr(len(b) - 1)
	}
	return syscall.UTF16ToString(b[:n])
}
func processInfo(h uintptr) (uint32, string, string) {
	var pid uint32
	pGetWindowThreadProcessID.Call(h, uintptr(unsafe.Pointer(&pid)))
	if pid == 0 {
		return 0, "", ""
	}
	ph, _, _ := pOpenProcess.Call(0x1000, 0, uintptr(pid))
	if ph == 0 {
		return pid, "", ""
	}
	defer pCloseHandle.Call(ph)
	b := make([]uint16, 32768)
	n := uint32(len(b))
	ok, _, _ := pQueryFullProcessImageNameW.Call(ph, 0, uintptr(unsafe.Pointer(&b[0])), uintptr(unsafe.Pointer(&n)))
	if ok == 0 || n == 0 || n > uint32(len(b)) {
		return pid, "", ""
	}
	full := syscall.UTF16ToString(b[:n])
	return pid, processName(full), full
}
func inspectWindow(h uintptr, c config) (candidate, bool) {
	if h == 0 || h == c.overlay || h == c.main {
		return candidate{}, false
	}
	visible, _, _ := pIsWindowVisible.Call(h)
	if visible == 0 {
		return candidate{}, false
	}
	owner, _, _ := pGetWindow.Call(h, 4)
	if owner != 0 {
		return candidate{}, false
	}
	if pDwmGetWindowAttribute.Find() == nil {
		var cloaked uint32
		hr, _, _ := pDwmGetWindowAttribute.Call(h, 14, uintptr(unsafe.Pointer(&cloaked)), 4)
		if int32(hr) == 0 && cloaked != 0 {
			return candidate{}, false
		}
	}
	r, ok := windowRect(h)
	if !ok || r.Right-r.Left < 480 || r.Bottom-r.Top < 320 {
		return candidate{}, false
	}
	title := strings.TrimSpace(windowText(h))
	if title == "" {
		return candidate{}, false
	}
	pid, proc, full := processInfo(h)
	switch proc {
	case "explorer.exe", "shellexperiencehost.exe", "searchhost.exe", "textinputhost.exe":
		return candidate{}, false
	}
	if proc == "" {
		proc = "unknown.exe"
	}
	fg, _, _ := pGetForegroundWindow.Call()
	mr, monOK := monitorRect(h)
	const tol int32 = 6
	fullscreen := monOK && r.Left <= mr.Left+tol && r.Top <= mr.Top+tol && r.Right >= mr.Right-tol && r.Bottom >= mr.Bottom-tol
	return candidate{HWND: fmt.Sprintf("0x%x", h), PID: pid, Process: proc, Path: full, Title: title, Class: className(h), Fullscreen: fullscreen, Foreground: h == fg, Width: r.Right - r.Left, Height: r.Bottom - r.Top}, true
}
func (p *windowsPlatform) reinforce(h uintptr) bool {
	if h == 0 {
		return false
	}
	valid, _, _ := pIsWindow.Call(h)
	vis, _, _ := pIsWindowVisible.Call(h)
	if valid == 0 || vis == 0 {
		return false
	}
	// Do NOT ShowWindow: hidden/off/popup-expired player windows must stay hidden.
	// ASYNCWINDOWPOS avoids a cross-thread wait on a busy Electron/game window.
	ok, _, _ := pSetWindowPos.Call(h, ^uintptr(0), 0, 0, 0, 0, 0x1|0x2|0x10|0x4000)
	return ok != 0
}
func (p *windowsPlatform) openRTSS() (*rtssClient, error) {
	name, _ := syscall.UTF16PtrFromString("RTSSSharedMemoryV2")
	handle, _, e := pOpenFileMappingW.Call(0x6, 0, uintptr(unsafe.Pointer(name)))
	if handle == 0 {
		return nil, e
	}
	addr, _, e := pMapViewOfFile.Call(handle, 0x6, 0, 0, 0)
	if addr == 0 {
		pCloseHandle.Call(handle)
		return nil, e
	}
	closeMapping := func() { pUnmapViewOfFile.Call(addr); pCloseHandle.Call(handle) }
	var mi memoryBasicInformation
	n, _, _ := pVirtualQuery.Call(addr, uintptr(unsafe.Pointer(&mi)), unsafe.Sizeof(mi))
	// The queried readable/writable committed region bounds all subsequent
	// header-derived indexing. Never invent a giant unsafe view from the header.
	if n < unsafe.Sizeof(mi) || mi.State != 0x1000 || mi.BaseAddress > addr || mi.Protect&0x100 != 0 || mi.Protect&(0x4|0x8|0x40|0x80) == 0 {
		closeMapping()
		return nil, errInvalidMapping
	}
	delta := addr - mi.BaseAddress
	if delta >= mi.RegionSize || mi.RegionSize-delta < 36 || mi.RegionSize-delta > 512*1024*1024 {
		closeMapping()
		return nil, errInvalidMapping
	}
	memory := unsafe.Slice((*byte)(unsafe.Pointer(addr)), int(mi.RegionSize-delta))
	client := &rtssClient{memory: memory, slot: -1, closeMapping: closeMapping}
	if _, err := client.layout(); err != nil {
		closeMapping()
		return nil, err
	}
	return client, nil
}
