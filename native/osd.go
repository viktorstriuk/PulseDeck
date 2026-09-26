package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"unicode"
)

func parseColor(s, fallback string) string {
	s = strings.TrimPrefix(strings.TrimSpace(s), "#")
	if len(s) != 6 {
		return fallback
	}
	if _, e := strconv.ParseUint(s, 16, 24); e != nil {
		return fallback
	}
	return strings.ToUpper(s)
}

func sanitizeOSDText(s string, limit int) string {
	s = strings.Map(func(r rune) rune {
		if r == '<' {
			return '('
		}
		if r == '>' {
			return ')'
		}
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return ' '
		}
		return r
	}, s)
	return limited(strings.Join(strings.Fields(s), " "), limit)
}
func formatDuration(t float64) string {
	n := int(nonnegative(t))
	return fmt.Sprintf("%d:%02d", n/60, n%60)
}
func progress(current, duration float64, width int) string {
	width = bounded(width, 1, 128)
	ratio := float64(0)
	if duration > 0 {
		ratio = math.Min(1, nonnegative(current)/duration)
	}
	n := bounded(int(math.Round(ratio*float64(width))), 0, width)
	return strings.Repeat("=", n) + strings.Repeat("-", width-n)
}
func spectrum(freq []float64, width int) string {
	const bars = " .:-=+*#%@"
	width = bounded(width, 1, 96)
	out := make([]byte, width)
	for i := range out {
		lo, hi := i*len(freq)/width, (i+1)*len(freq)/width
		peak := float64(0)
		for j := lo; j < hi; j++ {
			peak = math.Max(peak, nonnegative(freq[j]))
		}
		out[i] = bars[bounded(int(math.Round(peak*9/255)), 0, 9)]
	}
	return string(out)
}
func rtssPosition(c config) string {
	x, y := c.offsetX, c.offsetY
	if strings.HasSuffix(c.anchor, "right") {
		x = -max(1, x)
	}
	if strings.HasPrefix(c.anchor, "bottom") {
		y = -max(1, y)
	}
	return fmt.Sprintf("<P=%d,%d>", x, y)
}
func buildRTSSOSD(c config, m mediaSnapshot, version uint32) string {
	s := m.State
	title := sanitizeOSDText(s.Title, 54)
	if title == "" {
		title = "PulseDeck"
	}
	artist := sanitizeOSDText(s.Artist, 42)
	if artist == "" {
		artist = ""
	}
	playlist := sanitizeOSDText(s.Playlist, 30)
	subtitle := artist
	if playlist != "" {
		subtitle += "  /  " + playlist
	}
	marker := ">"
	if !s.Playing {
		marker = "||"
	}
	colored := version >= 0x2000b
	wrap := func(color, text string) string {
		if !colored {
			return text
		}
		return "<" + color + ">" + text + "<C>"
	}
	lines := []string{wrap("C0", marker+"  "+title), wrap("C2", subtitle), wrap("C1", fmt.Sprintf("%s  %s / %s", progress(s.CurrentTime, s.Duration, 30), formatDuration(s.CurrentTime), formatDuration(s.Duration)))}
	if c.visualizer && s.Playing {
		lines = append(lines, wrap("C0", spectrum(m.Freq, 38)))
	}
	prefix := ""
	if colored {
		prefix = fmt.Sprintf("<C0=%s><C1=%s><C2=AEB7C7>", c.color1, c.color2) + rtssPosition(c)
	}
	return prefix + strings.Join(lines, "\n")
}
