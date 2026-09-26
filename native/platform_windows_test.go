//go:build windows

package main

import (
	"syscall"
	"testing"
	"unsafe"
)

// These tests compile in the build container but require Windows to EXECUTE.
// Run `go test -run Windows -count=1` from native/ on the target OS.
func TestWindowsRealEnumWindowsRegistersOneCallback(t *testing.T) {
	p := newPlatform().(*windowsPlatform)
	registrations := 0
	p.enumerator.register = func(f func(uintptr, uintptr) uintptr) uintptr { registrations++; return syscall.NewCallback(f) }
	p.enumerator.inspect = func(h uintptr, c config) (candidate, bool) { return candidate{}, false }
	for i := 0; i < 10000; i++ {
		if _, e := p.enumerate(config{}); e != nil {
			t.Fatal(e)
		}
	}
	if registrations != 1 || len(p.enumerator.contexts) != 0 {
		t.Fatal("native callback/context leak")
	}
}
func TestWindowsStructureABI(t *testing.T) {
	if unsafe.Sizeof(memoryBasicInformation{}) != 48 || unsafe.Sizeof(monitorInfo{}) != 40 {
		t.Fatal("unexpected Windows x64 structure alignment")
	}
}
