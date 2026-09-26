package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"sync/atomic"
	"unicode/utf8"
	"unsafe"
)

const rtssSignature uint32 = 0x52545353
const rtssOwner = "PulseDeck.GameOverlay"

var errBusy = errors.New("RTSS shared memory busy")
var errInvalidMapping = errors.New("invalid RTSS shared memory layout")

type rtssLayout struct{ version, appSize, appOffset, appCount, osdSize, osdOffset, osdCount uint32 }
type rtssClient struct {
	memory       []byte
	slot         int
	closeMapping func()
	closed       bool
}
type rtssStatus struct {
	sharedVersion uint32
	Running       bool    `json:"running"`
	Hooked        bool    `json:"hooked"`
	Version       string  `json:"version,omitempty"`
	API           string  `json:"api,omitempty"`
	RenderWidth   uint32  `json:"renderWidth,omitempty"`
	RenderHeight  uint32  `json:"renderHeight,omitempty"`
	OutputWidth   uint32  `json:"outputWidth,omitempty"`
	OutputHeight  uint32  `json:"outputHeight,omitempty"`
	Stretched     bool    `json:"stretched"`
	AspectScaleX  float64 `json:"aspectScaleX"`
}

func u32(b []byte, at int) uint32      { return binary.LittleEndian.Uint32(b[at : at+4]) }
func put32(b []byte, at int, v uint32) { binary.LittleEndian.PutUint32(b[at:at+4], v) }
func arrayFits(offset, size, count, min uint32, n int) bool {
	return offset >= min && size > 0 && count > 0 && uint64(offset)+uint64(size)*uint64(count) <= uint64(n)
}
func (c *rtssClient) layout() (rtssLayout, error) {
	b := c.memory
	if c.closed || len(b) < 36 || u32(b, 0) != rtssSignature {
		return rtssLayout{}, errInvalidMapping
	}
	h := rtssLayout{u32(b, 4), u32(b, 8), u32(b, 12), u32(b, 16), u32(b, 20), u32(b, 24), u32(b, 28)}
	if h.version>>16 != 2 || h.appSize < 268 || h.appSize > 2*1024*1024 || h.appCount > 2048 || h.osdSize < 512 || h.osdSize > 1024*1024 || h.osdCount < 2 || h.osdCount > 128 {
		return h, errInvalidMapping
	}
	min := uint32(36)
	if h.version >= 0x2000e {
		min = 40
	}
	if h.version >= 0x20012 {
		min = 80
	}
	if !arrayFits(h.appOffset, h.appSize, h.appCount, min, len(b)) || !arrayFits(h.osdOffset, h.osdSize, h.osdCount, min, len(b)) {
		return h, errInvalidMapping
	}
	// Never let a corrupted header direct an OSD write over application entries.
	a0, a1 := uint64(h.appOffset), uint64(h.appOffset)+uint64(h.appSize)*uint64(h.appCount)
	o0, o1 := uint64(h.osdOffset), uint64(h.osdOffset)+uint64(h.osdSize)*uint64(h.osdCount)
	if a0 < o1 && o0 < a1 {
		return h, errInvalidMapping
	}
	return h, nil
}

func (c *rtssClient) withLock(f func(rtssLayout) error) error {
	h, err := c.layout()
	if err != nil {
		return err
	}
	if h.version < 0x2000e {
		return f(h)
	}
	ptr := (*uint32)(unsafe.Pointer(&c.memory[36]))
	// Bit 0 is the documented OSD access lock. Preserve any other bits. Don't
	// stall the input/heartbeat loop if RTSS or another client currently owns it.
	held := false
	for tries := 0; tries < 8; tries++ {
		v := atomic.LoadUint32(ptr)
		if v&1 != 0 {
			return errBusy
		}
		if atomic.CompareAndSwapUint32(ptr, v, v|1) {
			held = true
			break
		}
	}
	if !held {
		return errBusy
	}
	defer func() {
		for {
			v := atomic.LoadUint32(ptr)
			if atomic.CompareAndSwapUint32(ptr, v, v&^1) {
				break
			}
		}
	}()
	// The server may have invalidated its mapping while we acquired the lock.
	h, err = c.layout()
	if err != nil {
		return err
	}
	return f(h)
}

func cstring(b []byte) string {
	if n := bytes.IndexByte(b, 0); n >= 0 {
		b = b[:n]
	}
	return string(b)
}
func writeString(b []byte, s string) bool {
	data := []byte(s)
	if len(data) >= len(b) {
		data = data[:len(b)-1]
		for len(data) > 0 && !utf8.Valid(data) {
			data = data[:len(data)-1]
		}
	}
	if cstring(b) == string(data) {
		return false
	}
	clear(b)
	copy(b, data)
	return true
}
func (c *rtssClient) entry(h rtssLayout, slot int) []byte {
	at := int(h.osdOffset) + slot*int(h.osdSize)
	return c.memory[at : at+int(h.osdSize)]
}
func (c *rtssClient) findSlot(h rtssLayout) int {
	if c.slot > 0 && c.slot < int(h.osdCount) && cstring(c.entry(h, c.slot)[256:512]) == rtssOwner {
		return c.slot
	}
	for i := 1; i < int(h.osdCount); i++ {
		if cstring(c.entry(h, i)[256:512]) == rtssOwner {
			c.slot = i
			return i
		}
	}
	for i := 1; i < int(h.osdCount); i++ {
		if c.entry(h, i)[256] == 0 {
			c.slot = i
			return i
		}
	}
	return -1
}
func (c *rtssClient) updateText(text string) error {
	return c.withLock(func(h rtssLayout) error {
		slot := c.findSlot(h)
		if slot < 1 {
			return errors.New("no free RTSS OSD slot")
		}
		b := c.entry(h, slot)
		changed := writeString(b[256:512], rtssOwner)
		changed = writeString(b[:256], text) || changed
		if h.version >= 0x20007 && h.osdSize >= 4608 {
			changed = writeString(b[512:4608], text) || changed
		}
		if changed {
			atomic.AddUint32((*uint32)(unsafe.Pointer(&c.memory[32])), 1)
		}
		return nil
	})
}
func (c *rtssClient) release() error {
	return c.withLock(func(h rtssLayout) error {
		changed := false
		for i := 1; i < int(h.osdCount); i++ {
			b := c.entry(h, i)
			if cstring(b[256:512]) != rtssOwner {
				continue
			}
			clear(b[:512])
			if h.version >= 0x20007 && h.osdSize >= 4608 {
				clear(b[512:4608])
			}
			changed = true
		}
		c.slot = -1
		if changed {
			atomic.AddUint32((*uint32)(unsafe.Pointer(&c.memory[32])), 1)
		}
		return nil
	})
}
func (c *rtssClient) close() {
	if c == nil || c.closed {
		return
	}
	_ = c.release()
	c.closed = true
	if c.closeMapping != nil {
		c.closeMapping()
	}
	c.memory = nil
}

func rtssAPI(version, flags uint32) string {
	names := []string{"", "OpenGL", "DirectDraw", "Direct3D 8", "Direct3D 9", "Direct3D 9Ex", "Direct3D 10", "Direct3D 11", "Direct3D 12", "Direct3D 12 AFR", "Vulkan"}
	if version >= 0x2000a {
		n := flags & 0xffff
		if n < uint32(len(names)) {
			return names[n]
		}
		return ""
	}
	for _, item := range []struct {
		bit  uint32
		name string
	}{{1 << 24, "Direct3D 11"}, {1 << 20, "Direct3D 10"}, {1 << 16, "OpenGL"}, {1 << 13, "Direct3D 9Ex"}, {1 << 12, "Direct3D 9"}, {1 << 8, "Direct3D 8"}, {1 << 4, "DirectDraw"}} {
		if flags&item.bit != 0 {
			return item.name
		}
	}
	return ""
}
func (c *rtssClient) status(pid uint32, ow, oh uint32) (rtssStatus, error) {
	s := rtssStatus{AspectScaleX: 1, OutputWidth: ow, OutputHeight: oh}
	err := c.withLock(func(h rtssLayout) error {
		s.Running = true
		s.sharedVersion = h.version
		s.Version = fmt.Sprintf("%d.%d", h.version>>16, h.version&0xffff)
		if pid == 0 {
			return nil
		}
		for i := uint32(0); i < h.appCount; i++ {
			at := int(h.appOffset) + int(i)*int(h.appSize)
			b := c.memory[at : at+int(h.appSize)]
			if u32(b, 0) != pid {
				continue
			}
			s.API = rtssAPI(h.version, u32(b, 264))
			s.Hooked = s.API != ""
			// v2.18 introduced the app-entry OSD-statistics offset in the header.
			// Since v2.20, render resolution directly precedes that block. Match the
			// old PulseDeck helper's format, with explicit bounds for newer headers.
			if h.version >= 0x20014 && len(c.memory) >= 80 {
				off := u32(c.memory, 76)
				if off >= 8 && off <= h.appSize {
					rw, rh := u32(b, int(off)-8), u32(b, int(off)-4)
					if rw > 0 && rh > 0 && rw <= 32768 && rh <= 32768 {
						s.RenderWidth = rw
						s.RenderHeight = rh
					}
				}
			}
			if s.RenderWidth > 0 && s.RenderHeight > 0 && ow > 0 && oh > 0 {
				s.AspectScaleX = (float64(ow) / float64(oh)) / (float64(s.RenderWidth) / float64(s.RenderHeight))
				s.Stretched = math.Abs(s.AspectScaleX-1) > .025
			}
			break
		}
		return nil
	})
	return s, err
}
