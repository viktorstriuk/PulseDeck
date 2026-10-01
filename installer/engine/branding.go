package main

// VERSIONINFO is written after the verified Electron archive is extracted, but
// before the staged installation is committed. Renaming electron.exe alone
// leaves FileDescription=Electron (used by Explorer for a new taskbar pin).
import (
	"bytes"
	"encoding/binary"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf16"
)

func wideBytes(s string) []byte {
	var out bytes.Buffer
	for _, c := range append(utf16.Encode([]rune(s)), 0) {
		_ = binary.Write(&out, binary.LittleEndian, c)
	}
	return out.Bytes()
}
func resourceBlock(key string, kind, valueLength uint16, value []byte, children ...[]byte) []byte {
	var out bytes.Buffer
	for _, v := range []uint16{0, valueLength, kind} {
		_ = binary.Write(&out, binary.LittleEndian, v)
	}
	out.Write(wideBytes(key))
	pad := func() {
		for out.Len()%4 != 0 {
			out.WriteByte(0)
		}
	}
	pad()
	out.Write(value)
	for _, child := range children {
		pad()
		out.Write(child)
	}
	data := out.Bytes()
	binary.LittleEndian.PutUint16(data, uint16(len(data)))
	return data
}
func versionResource(version string) ([]byte, error) {
	parts := strings.Split(strings.Split(version, "-")[0], ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid product version")
	}
	nums := make([]uint32, 4)
	for i, p := range parts {
		n, e := strconv.ParseUint(p, 10, 16)
		if e != nil {
			return nil, e
		}
		nums[i] = uint32(n)
	}
	var fixed bytes.Buffer
	for _, v := range []uint32{0xFEEF04BD, 0x00010000, nums[0]<<16 | nums[1], nums[2] << 16, nums[0]<<16 | nums[1], nums[2] << 16, 0x3f, 0, 0x40004, 1, 0, 0, 0} {
		_ = binary.Write(&fixed, binary.LittleEndian, v)
	}
	fields := [][2]string{{"CompanyName", "MusheP"}, {"FileDescription", "PulseDeck"}, {"FileVersion", version}, {"InternalName", "PulseDeck"}, {"OriginalFilename", "PulseDeck.exe"}, {"ProductName", "PulseDeck"}, {"ProductVersion", version}, {"LegalCopyright", "PulseDeck contributors"}}
	stringsOut := make([][]byte, 0, len(fields))
	for _, f := range fields {
		value := wideBytes(f[1])
		stringsOut = append(stringsOut, resourceBlock(f[0], 1, uint16(len(value)/2), value))
	}
	table := resourceBlock("040904B0", 1, 0, nil, stringsOut...)
	translations := []byte{0x09, 0x04, 0xb0, 0x04}
	return resourceBlock("VS_VERSION_INFO", 0, uint16(fixed.Len()), fixed.Bytes(), resourceBlock("StringFileInfo", 1, 0, nil, table), resourceBlock("VarFileInfo", 1, 0, nil, resourceBlock("Translation", 0, 4, translations))), nil
}

// Replaceable only by installer unit fixtures; the product always brands the
// staged executable, never an installed/running one or an arbitrary renderer path.
var brandRuntime = brandExecutable
