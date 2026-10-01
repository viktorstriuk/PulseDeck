//go:build windows

package main

// The bootstrap must show progress before Electron is present. This small native
// shell is entirely owner-drawn: no OS buttons, titlebar or folder dialogs.
// Once the pinned runtime is ready, installer/ui becomes the actual interactive UI.
import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"math"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

type point struct{ X, Y int32 }
type rect struct{ L, T, R, B int32 }
type size struct{ W, H int32 }
type msg struct {
	H       uintptr
	M       uint32
	W, L    uintptr
	T       uint32
	P       point
	Private uint32
}
type wc struct {
	Size, Style                        uint32
	Proc                               uintptr
	Cls, Wnd                           int32
	Instance, Icon, Cursor, Background uintptr
	Menu, Name                         *uint16
	SmallIcon                          uintptr
}
type bmiHeader struct {
	Size                   uint32
	Width, Height          int32
	Planes, Bits           uint16
	Compression, ImageSize uint32
	XP, YP                 int32
	Used, Important        uint32
}
type bmi struct {
	Header bmiHeader
	Colors [3]uint32
}
type splashData struct {
	sync.Mutex
	event              Event
	err                error
	gui, done, closing bool
	cancel             context.CancelFunc
	words              map[string]string
	icon               image.Image
	version            string
	window             uintptr
	scale              float64
	work               func(context.Context, func(Event)) error
	doneChan           chan error
}

var splash *splashData

func (s *splashData) t(k string) string {
	if v := s.words[k]; v != "" {
		return v
	}
	return k
}
func startSplashWork() {
	ctx, cancel := context.WithCancel(context.Background())
	splash.Lock()
	splash.cancel = cancel
	splash.err = nil
	splash.done = false
	splash.event = Event{Phase: "preparing"}
	splash.Unlock()
	go func() {
		err := splash.work(ctx, func(e Event) {
			splash.Lock()
			splash.event = e
			if e.Phase == "gui" {
				splash.gui = true
			}
			splash.Unlock()
			u32.NewProc("PostMessageW").Call(splash.window, 0x8001, 0, 0)
		})
		splash.Lock()
		splash.err = err
		splash.done = true
		splash.Unlock()
		u32.NewProc("PostMessageW").Call(splash.window, 0x8001, 0, 0)
		splash.doneChan <- err
	}()
}
func splashProc(h uintptr, m uint32, w, l uintptr) uintptr {
	switch m {
	case 0x14:
		return 1
	case 0x113, 0x8001:
		splash.Lock()
		gui, done, err, closing := splash.gui, splash.done, splash.err, splash.closing
		splash.Unlock()
		if gui || done && err == nil || closing {
			u32.NewProc("DestroyWindow").Call(h)
			return 0
		}
		renderSplash(h)
		return 0
	case 0x84:
		var p point
		u32.NewProc("GetCursorPos").Call(uintptr(unsafe.Pointer(&p)))
		u32.NewProc("ScreenToClient").Call(h, uintptr(unsafe.Pointer(&p)))
		x, y := float64(p.X)/splash.scale, float64(p.Y)/splash.scale
		if y < 130 && !(x > 598 && y > 60) {
			return 2
		}
		return 1
	case 0x202:
		x, y := float64(int16(l&0xffff))/splash.scale, float64(int16((l>>16)&0xffff))/splash.scale
		splash.Lock()
		phase, err, done := splash.event.Phase, splash.err, splash.done
		splash.Unlock()
		if x > 596 && x < 637 && y > 66 && y < 105 {
			if phase == "installing" || phase == "finalizing" || phase == "rollback" {
				return 0
			}
			splash.Lock()
			splash.closing = true
			splash.cancel()
			splash.Unlock()
			u32.NewProc("DestroyWindow").Call(h)
			return 0
		}
		if err != nil && done && x > 450 && x < 618 && y > 294 && y < 338 {
			select {
			case <-splash.doneChan:
			default:
			}
			startSplashWork()
		}
		return 0
	case 0x10:
		splash.Lock()
		phase := splash.event.Phase
		splash.Unlock()
		if phase == "installing" || phase == "finalizing" || phase == "rollback" {
			return 0
		}
		splash.cancel()
		u32.NewProc("DestroyWindow").Call(h)
		return 0
	case 0x2:
		u32.NewProc("PostQuitMessage").Call(0)
		return 0
	}
	r, _, _ := u32.NewProc("DefWindowProcW").Call(h, uintptr(m), w, l)
	return r
}
func showSplash(p *Package, words map[string]string, work func(context.Context, func(Event)) error) error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	u32.NewProc("SetProcessDPIAware").Call()
	splash = &splashData{words: words, version: p.Manifest.Version, work: work, doneChan: make(chan error, 1), scale: 1}
	if f, ok := p.Files["app/assets/app-icons/blue-violet-monitor.png"]; ok {
		b, _ := zipBytes(f, 4*1024*1024)
		splash.icon, _ = png.Decode(bytes.NewReader(b))
	}
	if proc := u32.NewProc("GetDpiForSystem"); proc.Find() == nil {
		v, _, _ := proc.Call()
		if v > 0 {
			splash.scale = float64(v) / 96
		}
	}
	instance, _, _ := k32.NewProc("GetModuleHandleW").Call(0)
	cursor, _, _ := u32.NewProc("LoadCursorW").Call(0, 32512)
	klass := wc{Size: uint32(unsafe.Sizeof(wc{})), Proc: syscall.NewCallback(splashProc), Instance: instance, Cursor: cursor, Name: utf("PulseDeckBootstrap280")}
	u32.NewProc("RegisterClassExW").Call(uintptr(unsafe.Pointer(&klass)))
	screenW, _, _ := u32.NewProc("GetSystemMetrics").Call(0)
	screenH, _, _ := u32.NewProc("GetSystemMetrics").Call(1)
	width, height := int32(680*splash.scale), int32(390*splash.scale)
	h, _, err := u32.NewProc("CreateWindowExW").Call(0x80000|0x40000, uintptr(unsafe.Pointer(klass.Name)), uintptr(unsafe.Pointer(utf("PulseDeck Setup"))), 0x80000000, uintptr((int32(screenW)-width)/2), uintptr((int32(screenH)-height)/2), uintptr(width), uintptr(height), 0, 0, instance, 0)
	if h == 0 {
		return err
	}
	splash.window = h
	renderSplash(h)
	u32.NewProc("ShowWindow").Call(h, 5)
	u32.NewProc("SetTimer").Call(h, 1, 80, 0)
	startSplashWork()
	var message msg
	for {
		r, _, _ := u32.NewProc("GetMessageW").Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if r == 0 || r == ^uintptr(0) {
			break
		}
		u32.NewProc("TranslateMessage").Call(uintptr(unsafe.Pointer(&message)))
		u32.NewProc("DispatchMessageW").Call(uintptr(unsafe.Pointer(&message)))
	}
	return <-splash.doneChan
}
func blend(im *image.RGBA, x, y int, c color.NRGBA, coverage float64) {
	if !image.Pt(x, y).In(im.Bounds()) {
		return
	}
	a := float64(c.A) / 255 * math.Max(0, math.Min(1, coverage))
	i := im.PixOffset(x, y)
	old := im.Pix[i : i+4]
	inv := 1 - a
	old[0] = uint8(float64(c.R)*a + float64(old[0])*inv)
	old[1] = uint8(float64(c.G)*a + float64(old[1])*inv)
	old[2] = uint8(float64(c.B)*a + float64(old[2])*inv)
	old[3] = uint8(255*a + float64(old[3])*inv)
}
func roundBox(im *image.RGBA, x, y, w, h, r float64, c color.NRGBA) {
	sc := splash.scale
	x *= sc
	y *= sc
	w *= sc
	h *= sc
	r *= sc
	for py := int(y) - 1; py < int(y+h)+1; py++ {
		for px := int(x) - 1; px < int(x+w)+1; px++ {
			dx := math.Max(math.Abs(float64(px)+.5-(x+w/2))-(w/2-r), 0)
			dy := math.Max(math.Abs(float64(py)+.5-(y+h/2))-(h/2-r), 0)
			coverage := math.Max(0, math.Min(1, r+.5-math.Hypot(dx, dy)))
			blend(im, px, py, c, coverage)
		}
	}
}
func drawIcon(im *image.RGBA, src image.Image, x, y, w float64) {
	if src == nil {
		return
	}
	s := splash.scale
	ix, iy, iw := int(x*s), int(y*s), int(w*s)
	b := src.Bounds()
	for py := 0; py < iw; py++ {
		for px := 0; px < iw; px++ {
			sx := float64(px) * float64(b.Dx()-1) / float64(iw-1)
			sy := float64(py) * float64(b.Dy()-1) / float64(iw-1)
			x0, y0 := int(sx), int(sy)
			fx, fy := sx-float64(x0), sy-float64(y0)
			var rr, gg, bb, aa float64
			for j := 0; j < 2; j++ {
				for i := 0; i < 2; i++ {
					weight := []float64{1 - fx, fx}[i] * []float64{1 - fy, fy}[j]
					r, g, b, a := src.At(b.Min.X+x0+i, b.Min.Y+y0+j).RGBA()
					rr += float64(r) * weight / 257
					gg += float64(g) * weight / 257
					bb += float64(b) * weight / 257
					aa += float64(a) * weight / 257
				}
			}
			if image.Pt(ix+px, iy+py).In(im.Bounds()) {
				pos := im.PixOffset(ix+px, iy+py)
				inv := 1 - aa/255
				im.Pix[pos] = uint8(rr + float64(im.Pix[pos])*inv)
				im.Pix[pos+1] = uint8(gg + float64(im.Pix[pos+1])*inv)
				im.Pix[pos+2] = uint8(bb + float64(im.Pix[pos+2])*inv)
				im.Pix[pos+3] = uint8(aa + float64(im.Pix[pos+3])*inv)
			}
		}
	}
}
func nativeText(dc uintptr, value string, x, y, w, h, fontSize float64, weight int32, c uint32) {
	sc := splash.scale
	font, _, _ := g32.NewProc("CreateFontW").Call(uintptr(int32(-fontSize*sc)), 0, 0, 0, uintptr(weight), 0, 0, 0, 1, 0, 0, 4, 0, uintptr(unsafe.Pointer(utf("Segoe UI"))))
	old, _, _ := g32.NewProc("SelectObject").Call(dc, font)
	g32.NewProc("SetBkMode").Call(dc, 1)
	g32.NewProc("SetTextColor").Call(dc, uintptr(c))
	box := rect{int32(x * sc), int32(y * sc), int32((x + w) * sc), int32((y + h) * sc)}
	u32.NewProc("DrawTextW").Call(dc, uintptr(unsafe.Pointer(utf(value))), ^uintptr(0), uintptr(unsafe.Pointer(&box)), 0x10|0x800)
	g32.NewProc("SelectObject").Call(dc, old)
	g32.NewProc("DeleteObject").Call(font)
}
func renderSplash(h uintptr) {
	if splash == nil {
		return
	}
	splash.Lock()
	event, err := splash.event, splash.err
	splash.Unlock()
	light := !systemUsesDarkTheme()
	border, panel, button, icon, track := color.NRGBA{45, 53, 69, 255}, color.NRGBA{21, 24, 33, 255}, color.NRGBA{35, 40, 53, 255}, color.NRGBA{188, 199, 214, 255}, color.NRGBA{39, 45, 59, 255}
	textColor, mutedColor, secondaryColor := uint32(0x00FBF7F6), uint32(0x0098877F), uint32(0x00CCC0BA)
	if light {
		border = color.NRGBA{211, 218, 234, 255}
		panel = color.NRGBA{246, 248, 253, 255}
		button = color.NRGBA{229, 233, 243, 255}
		icon = color.NRGBA{65, 76, 104, 255}
		track = color.NRGBA{222, 228, 240, 255}
		textColor = 0x00332A21
		mutedColor = 0x007F6D5C
		secondaryColor = 0x00655040
	}
	sc := splash.scale
	width, height := int(680*sc), int(390*sc)
	im := image.NewRGBA(image.Rect(0, 0, width, height))
	for n := 12; n > 0; n-- {
		roundBox(im, 30-float64(n), 55+float64(n)/2, 620+2*float64(n), 290+float64(n), 26+float64(n), color.NRGBA{0, 0, 0, 4})
	}
	roundBox(im, 30, 55, 620, 290, 26, border)
	roundBox(im, 31, 56, 618, 288, 25, panel)
	drawIcon(im, splash.icon, 46, 14, 104)
	roundBox(im, 594, 67, 38, 36, 11, button)
	for n := 0; n < 13; n++ {
		roundBox(im, 607+float64(n), 79+float64(n), 2, 2, 1, icon)
		roundBox(im, 619-float64(n), 79+float64(n), 2, 2, 1, icon)
	}
	roundBox(im, 58, 266, 564, 5, 2.5, track)
	pct := math.Max(0, math.Min(100, event.Percent))
	if pct > 0 {
		roundBox(im, 58, 266, 564*pct/100, 5, 2.5, color.NRGBA{96, 135, 249, 255})
	} else if err == nil {
		x := float64(time.Now().UnixMilli()%2400) / 2400 * 444
		roundBox(im, 58+x, 266, 120, 5, 2.5, color.NRGBA{96, 135, 249, 255})
	}
	if err != nil {
		roundBox(im, 450, 296, 172, 34, 10, color.NRGBA{76, 112, 230, 255})
	}
	screen, _, _ := u32.NewProc("GetDC").Call(0)
	defer u32.NewProc("ReleaseDC").Call(0, screen)
	dc, _, _ := g32.NewProc("CreateCompatibleDC").Call(screen)
	defer g32.NewProc("DeleteDC").Call(dc)
	info := bmi{Header: bmiHeader{Size: 40, Width: int32(width), Height: -int32(height), Planes: 1, Bits: 32}}
	var pointer unsafe.Pointer
	bitmap, _, _ := g32.NewProc("CreateDIBSection").Call(screen, uintptr(unsafe.Pointer(&info)), 0, uintptr(unsafe.Pointer(&pointer)), 0, 0)
	if bitmap == 0 {
		return
	}
	defer g32.NewProc("DeleteObject").Call(bitmap)
	old, _, _ := g32.NewProc("SelectObject").Call(dc, bitmap)
	defer g32.NewProc("SelectObject").Call(dc, old)
	pixels := unsafe.Slice((*byte)(pointer), width*height*4)
	for i := 0; i < len(pixels); i += 4 {
		pixels[i] = im.Pix[i+2]
		pixels[i+1] = im.Pix[i+1]
		pixels[i+2] = im.Pix[i]
		pixels[i+3] = im.Pix[i+3]
	}
	nativeText(dc, "PulseDeck", 166, 73, 390, 35, 25, 700, textColor)
	nativeText(dc, strings.ReplaceAll(splash.t("SetupVersion"), "{version}", splash.version), 58, 306, 372, 26, 11, 400, mutedColor)
	key := map[string]string{"runtime": "SetupRuntime", "components": "SetupComponents", "extracting": "SetupExtracting", "installing": "SetupInstalling", "finalizing": "SetupFinalizing", "launching": "SetupLaunching", "waiting": "SetupWaiting", "verifying": "SetupVerifying", "rollback": "SetupRollback"}[event.Phase]
	if key == "" {
		key = "SetupPreparing"
	}
	detail := "SetupRuntimeHint"
	if err != nil {
		key = "SetupFailed"
		detail = errorCode(err)
	}
	nativeText(dc, splash.t(key), 58, 144, 564, 52, 22, 650, textColor)
	nativeText(dc, splash.t(detail), 58, 202, 558, 49, 13, 400, secondaryColor)
	if err != nil {
		nativeText(dc, splash.t("SetupRetry"), 470, 302, 146, 27, 13, 650, 0x00FFFFFF)
	}
	// GDI text clears alpha bits. Only fully opaque card interiors contain text.
	for py := int(65 * sc); py < int(335*sc); py++ {
		for px := int(55 * sc); px < int(630*sc); px++ {
			pixels[(py*width+px)*4+3] = 255
		}
	}
	var pos rect
	u32.NewProc("GetWindowRect").Call(h, uintptr(unsafe.Pointer(&pos)))
	dst := point{pos.L, pos.T}
	source := point{}
	sz := size{int32(width), int32(height)}
	blendFn := [4]byte{0, 0, 255, 1}
	u32.NewProc("UpdateLayeredWindow").Call(h, screen, uintptr(unsafe.Pointer(&dst)), uintptr(unsafe.Pointer(&sz)), dc, uintptr(unsafe.Pointer(&source)), 0, uintptr(unsafe.Pointer(&blendFn)), 2)
}
