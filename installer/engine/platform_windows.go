//go:build windows

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var k32, u32, g32 = syscall.NewLazyDLL("kernel32.dll"), syscall.NewLazyDLL("user32.dll"), syscall.NewLazyDLL("gdi32.dll")

func utf(s string) *uint16    { p, _ := syscall.UTF16PtrFromString(s); return p }
func hideProcess(c *exec.Cmd) { c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true} }
func replaceAtomic(src, dst string) error {
	r, _, e := k32.NewProc("MoveFileExW").Call(uintptr(unsafe.Pointer(utf(src))), uintptr(unsafe.Pointer(utf(dst))), 0x1|0x8)
	if r == 0 {
		return e
	}
	return nil
}
func freeSpace(path string) (uint64, bool) {
	var free uint64
	r, _, _ := k32.NewProc("GetDiskFreeSpaceExW").Call(uintptr(unsafe.Pointer(utf(path))), uintptr(unsafe.Pointer(&free)), 0, 0)
	return free, r != 0
}
func enoughSpace(path string, needed uint64) bool {
	free, ok := freeSpace(path)
	return ok && free >= needed
}
func processAlive(pid int) bool {
	h, _, _ := k32.NewProc("OpenProcess").Call(0x100000, 0, uintptr(pid))
	if h == 0 {
		return false
	}
	defer k32.NewProc("CloseHandle").Call(h)
	status, _, _ := k32.NewProc("WaitForSingleObject").Call(h, 0)
	return status == 258
}
func waitProcess(ctx context.Context, pid int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for processAlive(pid) {
		if time.Now().After(deadline) {
			return errors.New("SETUP_LOCKED")
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(120 * time.Millisecond):
		}
	}
	return nil
}

type processEntry struct {
	Size     uint32
	Usage    uint32
	PID      uint32
	Heap     uintptr
	Module   uint32
	Threads  uint32
	Parent   uint32
	Priority int32
	Flags    uint32
	Exe      [260]uint16
}

func processAt(target string) bool {
	h, _, _ := k32.NewProc("CreateToolhelp32Snapshot").Call(2, 0)
	if h == ^uintptr(0) {
		return false
	}
	defer k32.NewProc("CloseHandle").Call(h)
	var e processEntry
	e.Size = uint32(unsafe.Sizeof(e))
	r, _, _ := k32.NewProc("Process32FirstW").Call(h, uintptr(unsafe.Pointer(&e)))
	for r != 0 {
		if strings.EqualFold(syscall.UTF16ToString(e.Exe[:]), filepath.Base(target)) {
			p, _, _ := k32.NewProc("OpenProcess").Call(0x1000, 0, uintptr(e.PID))
			if p != 0 {
				buf := make([]uint16, 32768)
				size := uint32(len(buf))
				ok, _, _ := k32.NewProc("QueryFullProcessImageNameW").Call(p, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&size)))
				k32.NewProc("CloseHandle").Call(p)
				if ok != 0 && strings.EqualFold(syscall.UTF16ToString(buf[:size]), target) {
					return true
				}
			}
		}
		r, _, _ = k32.NewProc("Process32NextW").Call(h, uintptr(unsafe.Pointer(&e)))
	}
	return false
}
func psQuote(s string) string { return strings.ReplaceAll(s, "'", "''") }
func desktopDir() string {
	type guid struct {
		A    uint32
		B, C uint16
		D    [8]byte
	}
	id := guid{0xB4BFCC3A, 0xDB2C, 0x424C, [8]byte{0xB0, 0x29, 0x7F, 0xE9, 0x9A, 0x87, 0xC6, 0x41}}
	var result *uint16
	shell := syscall.NewLazyDLL("shell32.dll")
	hr, _, _ := shell.NewProc("SHGetKnownFolderPath").Call(uintptr(unsafe.Pointer(&id)), 0, 0, uintptr(unsafe.Pointer(&result)))
	if hr == 0 && result != nil {
		defer syscall.NewLazyDLL("ole32.dll").NewProc("CoTaskMemFree").Call(uintptr(unsafe.Pointer(result)))
		a := unsafe.Slice(result, 32768)
		n := 0
		for a[n] != 0 && n < 32767 {
			n++
		}
		return syscall.UTF16ToString(a[:n])
	}
	return filepath.Join(os.Getenv("USERPROFILE"), "Desktop")
}
func createAppShortcut(target string) error {
	link := filepath.Join(desktopDir(), "PulseDeck.lnk")
	icon := filepath.Join(target, "resources", "app", "assets", "app-icons", "blue-violet-monitor.ico")
	script := fmt.Sprintf("$s=(New-Object -ComObject WScript.Shell).CreateShortcut('%s');$s.TargetPath='%s';$s.WorkingDirectory='%s';$s.IconLocation='%s';$s.Save()", psQuote(link), psQuote(filepath.Join(target, "PulseDeck.exe")), psQuote(target), psQuote(icon))
	c := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	hideProcess(c)
	return c.Run()
}

const uninstallKey = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\PulseDeck`

func registerApplication(target, version string) error {
	values := map[string]string{"DisplayName": "PulseDeck", "DisplayVersion": version, "Publisher": "MusheP", "InstallLocation": target, "DisplayIcon": filepath.Join(target, "resources", "app", "assets", "app-icons", "blue-violet-monitor.ico"), "UninstallString": `"` + filepath.Join(target, "Uninstall PulseDeck.exe") + `" --uninstall --target "` + target + `"`}
	for k, v := range values {
		c := exec.Command("reg.exe", "ADD", uninstallKey, "/v", k, "/t", "REG_SZ", "/d", v, "/f")
		hideProcess(c)
		if e := c.Run(); e != nil {
			return e
		}
	}
	return nil
}
func unregisterApplication(target string) {
	c := exec.Command("reg.exe", "DELETE", uninstallKey, "/f")
	hideProcess(c)
	c.Run()
	script := fmt.Sprintf("$p='%s';if(Test-Path -LiteralPath $p){$s=(New-Object -ComObject WScript.Shell).CreateShortcut($p);if($s.TargetPath -eq '%s'){Remove-Item -LiteralPath $p}}", psQuote(filepath.Join(desktopDir(), "PulseDeck.lnk")), psQuote(filepath.Join(target, "PulseDeck.exe")))
	c = exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	hideProcess(c)
	c.Run()
}

// Windows UI-language preferences are independent of the numeric/date region.
func preferredUILanguages() []string {
	proc := k32.NewProc("GetUserPreferredUILanguages")
	var count, length uint32
	proc.Call(8, uintptr(unsafe.Pointer(&count)), 0, uintptr(unsafe.Pointer(&length)))
	if length > 1 && length < 32768 {
		buffer := make([]uint16, length)
		ok, _, _ := proc.Call(8, uintptr(unsafe.Pointer(&count)), uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&length)))
		if ok != 0 {
			out := []string{}
			start := 0
			for i, v := range buffer {
				if v == 0 {
					if i == start {
						break
					}
					out = append(out, syscall.UTF16ToString(buffer[start:i]))
					start = i + 1
				}
			}
			if len(out) > 0 {
				return out
			}
		}
	}
	var buffer [85]uint16
	ok, _, _ := k32.NewProc("GetUserDefaultLocaleName").Call(uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
	if ok > 0 {
		return []string{syscall.UTF16ToString(buffer[:])}
	}
	return []string{"en"}
}
func systemUsesDarkTheme() bool {
	var key syscall.Handle
	if syscall.RegOpenKeyEx(syscall.HKEY_CURRENT_USER, utf(`Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`), 0, syscall.KEY_QUERY_VALUE, &key) != nil {
		return false
	}
	defer syscall.RegCloseKey(key)
	var value uint32 = 1
	var kind uint32
	size := uint32(4)
	err := syscall.RegQueryValueEx(key, utf("AppsUseLightTheme"), nil, &kind, (*byte)(unsafe.Pointer(&value)), &size)
	return err == nil && kind == syscall.REG_DWORD && size == 4 && value == 0
}
