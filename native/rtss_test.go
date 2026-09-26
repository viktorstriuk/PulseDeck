package main

import (
	"bytes"
	"errors"
	"strings"
	"testing"
	"unicode/utf8"
)

func rtssFixture(version uint32) *rtssClient {
	const appOffset = 256
	const appSize = 512
	const appCount = 4
	const osdSize = 4608
	const osdCount = 8
	const osdOffset = appOffset + appSize*appCount
	b := make([]byte, osdOffset+osdSize*osdCount)
	for at, v := range map[int]uint32{0: rtssSignature, 4: version, 8: appSize, 12: appOffset, 16: appCount, 20: osdSize, 24: osdOffset, 28: osdCount, 76: 300} {
		put32(b, at, v)
	}
	return &rtssClient{memory: b, slot: -1}
}
func TestRTSSWriteAndReleaseOnlyOwnedSlot(t *testing.T) {
	for _, v := range []uint32{0x20000, 0x20007, 0x2000e, 0x20014, 0x20015} {
		c := rtssFixture(v)
		h, _ := c.layout()
		other := c.entry(h, 1)
		writeString(other[256:512], "Other app")
		writeString(other[:256], "other overlay")
		before := append([]byte(nil), other...)
		if e := c.updateText("Трек в RTSS"); e != nil {
			t.Fatal(e)
		}
		if c.slot != 2 {
			t.Fatal("reserved/occupied slot overwritten")
		}
		own := c.entry(h, 2)
		if cstring(own[256:512]) != rtssOwner || cstring(own[:256]) != "Трек в RTSS" {
			t.Fatal("legacy text missing")
		}
		if v >= 0x20007 && cstring(own[512:4608]) != "Трек в RTSS" {
			t.Fatal("extended text missing")
		}
		frame := u32(c.memory, 32)
		c.updateText("Трек в RTSS")
		if u32(c.memory, 32) != frame {
			t.Fatal("unchanged frame incremented")
		}
		if e := c.release(); e != nil {
			t.Fatal(e)
		}
		if !bytes.Equal(other, before) || cstring(own[256:512]) != "" || u32(c.memory, 32) != frame+1 {
			t.Fatal("release corrupted another client")
		}
	}
}
func TestRTSSReusesCrashedOwnerAndRefusesFullArray(t *testing.T) {
	c := rtssFixture(0x20014)
	h, _ := c.layout()
	writeString(c.entry(h, 4)[256:512], rtssOwner)
	if e := c.updateText("new"); e != nil || c.slot != 4 {
		t.Fatal("did not reuse abandoned own slot")
	}
	c.release()
	for i := 1; i < int(h.osdCount); i++ {
		writeString(c.entry(h, i)[256:512], "Other")
	}
	before := append([]byte(nil), c.memory...)
	if e := c.updateText("ours"); e == nil || !bytes.Equal(before, c.memory) {
		t.Fatal("overwrote occupied slot")
	}
}
func TestRTSSBusyLockPreservesOtherBitsAndAlwaysUnlocks(t *testing.T) {
	c := rtssFixture(0x20014)
	put32(c.memory, 36, 0x80)
	if e := c.withLock(func(h rtssLayout) error {
		if u32(c.memory, 36) != 0x81 {
			t.Fatal("lock not acquired")
		}
		return errors.New("test error")
	}); e == nil {
		t.Fatal("missing callback error")
	}
	if u32(c.memory, 36) != 0x80 {
		t.Fatal("lost other bits or failed unlock")
	}
	put32(c.memory, 36, 0x81)
	before := append([]byte(nil), c.memory...)
	if !errors.Is(c.updateText("busy"), errBusy) || !bytes.Equal(before, c.memory) {
		t.Fatal("wrote while locked")
	}
}
func TestRTSSRejectsCorruptLayoutsWithoutAnyWrite(t *testing.T) {
	corrupt := []func([]byte){func(b []byte) { put32(b, 0, 0) }, func(b []byte) { put32(b, 4, 0x30000) }, func(b []byte) { put32(b, 12, 0xfffffff0) }, func(b []byte) { put32(b, 16, 0xffffffff) }, func(b []byte) { put32(b, 20, 1) }, func(b []byte) { put32(b, 24, 256) }, func(b []byte) { put32(b, 28, 0xffffffff) }, func(b []byte) { put32(b, 8, 2) }}
	for _, f := range corrupt {
		c := rtssFixture(0x20014)
		f(c.memory)
		before := append([]byte(nil), c.memory...)
		if e := c.updateText("must not write"); e == nil {
			t.Fatal("invalid layout accepted")
		}
		if !bytes.Equal(before, c.memory) {
			t.Fatal("changed invalid mapping")
		}
	}
	for n := 0; n < 36; n++ {
		c := &rtssClient{memory: make([]byte, n)}
		if _, e := c.layout(); e == nil {
			t.Fatal("short header accepted")
		}
	}
}
func TestRTSSStatusAPIAndStretchedResolution(t *testing.T) {
	c := rtssFixture(0x20014)
	h, _ := c.layout()
	at := int(h.appOffset)
	put32(c.memory, at, 42)
	put32(c.memory, at+264, 10)
	put32(c.memory, at+292, 1440)
	put32(c.memory, at+296, 1080)
	s, e := c.status(42, 1920, 1080)
	if e != nil || !s.Running || !s.Hooked || s.API != "Vulkan" || s.RenderWidth != 1440 || !s.Stretched || s.AspectScaleX < 1.33 {
		t.Fatalf("bad status: %+v %v", s, e)
	}
	s, e = c.status(99, 1920, 1080)
	if e != nil || s.Hooked {
		t.Fatal("hook reported for wrong PID")
	}
	if rtssAPI(0x20009, 1<<24) != "Direct3D 11" || rtssAPI(0x2000a, 8) != "Direct3D 12" || rtssAPI(0x20014, 0) != "" {
		t.Fatal("legacy/new API flags")
	}
	put32(c.memory, 76, 0xffffffff)
	if _, e := c.status(42, 1920, 1080); e != nil {
		t.Fatal(e)
	}
}
func TestRTSSUnicodeTruncationAndIdempotentClose(t *testing.T) {
	c := rtssFixture(0x20014)
	closed := 0
	c.closeMapping = func() { closed++ }
	c.updateText(strings.Repeat("Ж🎵", 2000))
	h, _ := c.layout()
	entry := c.entry(h, c.slot)
	if !utf8.ValidString(cstring(entry[:256])) || !utf8.ValidString(cstring(entry[512:4608])) {
		t.Fatal("truncated inside UTF-8")
	}
	c.close()
	c.close()
	if closed != 1 || len(c.memory) != 0 {
		t.Fatal("mapping not closed once")
	}
}
