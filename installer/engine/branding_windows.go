//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

func brandExecutable(file, version string) error {
	data, err := versionResource(version)
	if err != nil {
		return err
	}
	// Fixtures cannot be mistaken for an executable in the production path.
	head, err := os.Open(file)
	if err != nil {
		return err
	}
	b := make([]byte, 64)
	n, _ := head.Read(b)
	head.Close()
	if n != 64 || b[0] != 'M' || b[1] != 'Z' {
		return fmt.Errorf("SETUP_INTEGRITY: invalid PE for branding")
	}
	h, _, e := k32.NewProc("BeginUpdateResourceW").Call(uintptr(unsafe.Pointer(utf(file))), 0)
	if h == 0 {
		return fmt.Errorf("brand BeginUpdateResourceW: %w", e)
	}
	committed := false
	defer func() {
		if !committed {
			k32.NewProc("EndUpdateResourceW").Call(h, 1)
		}
	}()
	// Electron's RT_VERSION/1 is English (US). The string table and Translation
	// agree; Explorer does not need a running renderer to obtain the product name.
	ok, _, e := k32.NewProc("UpdateResourceW").Call(h, 16, 1, 0x409, uintptr(unsafe.Pointer(&data[0])), uintptr(len(data)))
	if ok == 0 {
		return fmt.Errorf("brand UpdateResourceW: %w", e)
	}
	ok, _, e = k32.NewProc("EndUpdateResourceW").Call(h, 0)
	committed = true
	if ok == 0 && e != syscall.Errno(0) {
		return fmt.Errorf("brand EndUpdateResourceW: %w", e)
	}
	if ok == 0 {
		return fmt.Errorf("brand EndUpdateResourceW failed")
	}
	return nil
}
