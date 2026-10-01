package main

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

type setupFailure struct {
	Code string
	Data map[string]string
	Err  error
}

func (e *setupFailure) Error() string {
	if e == nil {
		return ""
	}
	if e.Err == nil {
		return e.Code
	}
	return e.Code + ": " + e.Err.Error()
}
func (e *setupFailure) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

func setupFail(code string, err error, data map[string]string) error {
	if err == nil {
		err = errors.New(code)
	}
	return &setupFailure{Code: code, Data: data, Err: err}
}

func annotateFailure(err error, key, value string) error {
	if err == nil || key == "" || value == "" {
		return err
	}
	var failure *setupFailure
	if errors.As(err, &failure) && failure.Code != "" {
		data := cloneStrings(failure.Data)
		if data == nil {
			data = map[string]string{}
		}
		data[key] = value
		return setupFail(failure.Code, err, data)
	}
	return err
}
func errorData(e error) (string, map[string]string) {
	if e == nil {
		return "", nil
	}
	var failure *setupFailure
	if errors.As(e, &failure) && failure.Code != "" {
		return failure.Code, cloneStrings(failure.Data)
	}
	text := e.Error()
	switch {
	case strings.Contains(text, "SETUP_LAUNCH_TIMEOUT"):
		return "SetupLaunchTimeout", nil
	case strings.Contains(text, "SETUP_LAUNCH"):
		return "SetupLaunchFailed", nil
	case strings.Contains(text, "SETUP_PATH"):
		return "SetupErrorPath", nil
	case strings.Contains(text, "SETUP_LANGUAGE_SAVE"):
		return "SetupErrorLanguageSave", nil
	case strings.Contains(text, "SETUP_SETTINGS"):
		return "SetupErrorSettings", nil
	case strings.Contains(text, "SETUP_LANGUAGE"):
		return "SetupErrorLanguage", nil
	case strings.Contains(text, "SETUP_LOCKED"):
		return "SetupErrorLocked", nil
	case strings.Contains(text, "SETUP_INTEGRITY") || strings.Contains(strings.ToLower(text), "checksum"):
		return "SetupErrorIntegrity", nil
	case strings.Contains(text, "SETUP_DISK"):
		return "SetupErrorDisk", nil
	}
	if errors.Is(e, context.DeadlineExceeded) {
		return "SetupErrorNetworkTimeout", nil
	}
	if errors.Is(e, context.Canceled) {
		return "SetupErrorNetworkInterrupted", nil
	}
	var dns *net.DNSError
	if errors.As(e, &dns) {
		return "SetupErrorNetworkDNS", nil
	}
	var cert x509.UnknownAuthorityError
	if errors.As(e, &cert) || strings.Contains(strings.ToLower(text), "certificate") || strings.Contains(strings.ToLower(text), "tls") {
		return "SetupErrorTLS", nil
	}
	if securitySoftwareError(e) {
		return "SetupErrorSecuritySoftware", nil
	}
	if permissionError(e) {
		return "SetupErrorPermissions", nil
	}
	if diskFullError(e) {
		return "SetupErrorDisk", nil
	}
	if sharingError(e) {
		return "SetupErrorLocked", nil
	}
	var netErr net.Error
	if errors.As(e, &netErr) {
		if netErr.Timeout() {
			return "SetupErrorNetworkTimeout", nil
		}
		return "SetupErrorNetworkInterrupted", nil
	}
	if strings.Contains(text, "SETUP_COMPONENTS") {
		return "SetupErrorComponents", nil
	}
	return "SetupErrorGeneric", nil
}

func errorCode(e error) string { code, _ := errorData(e); return code }

func cloneStrings(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]string, len(input))
	for k, v := range input {
		out[k] = v
	}
	return out
}

func permissionError(err error) bool {
	if errors.Is(err, os.ErrPermission) || errors.Is(err, syscall.EACCES) || errors.Is(err, syscall.EPERM) {
		return true
	}
	var errno syscall.Errno
	return errors.As(err, &errno) && errno == syscall.Errno(5)
}
func diskFullError(err error) bool {
	if errors.Is(err, syscall.ENOSPC) {
		return true
	}
	var errno syscall.Errno
	return errors.As(err, &errno) && (errno == syscall.Errno(39) || errno == syscall.Errno(112))
}
func sharingError(err error) bool {
	var errno syscall.Errno
	return errors.As(err, &errno) && (errno == syscall.Errno(32) || errno == syscall.Errno(33))
}
func securitySoftwareError(err error) bool {
	var errno syscall.Errno
	return errors.As(err, &errno) && (errno == syscall.Errno(225) || errno == syscall.Errno(577))
}

func networkFailure(err error) error {
	if err == nil {
		return nil
	}
	code, _ := errorData(err)
	if code != "SetupErrorGeneric" {
		return setupFail(code, err, nil)
	}
	return setupFail("SetupErrorNetworkInterrupted", err, nil)
}

func httpFailure(status int, address string) error {
	meta := map[string]string{"status": fmt.Sprintf("%d", status), "host": safeHost(address)}
	switch status {
	case 407:
		return setupFail("SetupErrorProxyAuth", fmt.Errorf("HTTP %d from %s", status, address), meta)
	case 401, 403:
		return setupFail("SetupErrorSourceDenied", fmt.Errorf("HTTP %d from %s", status, address), meta)
	case 404, 410:
		return setupFail("SetupErrorSourceMissing", fmt.Errorf("HTTP %d from %s", status, address), meta)
	case 408:
		return setupFail("SetupErrorNetworkTimeout", fmt.Errorf("HTTP %d from %s", status, address), meta)
	case 429:
		return setupFail("SetupErrorRateLimited", fmt.Errorf("HTTP %d from %s", status, address), meta)
	}
	if status >= 500 && status <= 599 {
		return setupFail("SetupErrorServer", fmt.Errorf("HTTP %d from %s", status, address), meta)
	}
	return setupFail("SetupErrorNetworkHTTP", fmt.Errorf("HTTP %d from %s", status, address), meta)
}

func safeHost(raw string) string {
	// Avoid importing net/url into every call-site; network errors only need a
	// human-readable host. Never expose query strings in a report summary.
	raw = strings.TrimPrefix(raw, "https://")
	if i := strings.IndexByte(raw, '/'); i >= 0 {
		raw = raw[:i]
	}
	if len(raw) > 120 {
		raw = raw[:120]
	}
	return raw
}

func formatBytes(value uint64) string {
	const gb = 1024 * 1024 * 1024
	const mb = 1024 * 1024
	if value >= gb {
		return fmt.Sprintf("%.1f GB", float64(value)/float64(gb))
	}
	return fmt.Sprintf("%.0f MB", float64(value)/float64(mb))
}

func driveLabel(target string) string {
	volume := filepath.VolumeName(target)
	if volume != "" {
		return volume
	}
	if filepath.IsAbs(target) {
		return string(filepath.Separator)
	}
	return target
}

func diagnosticReport(err error, target, version, mode string) string {
	if err == nil {
		return ""
	}
	dir := filepath.Join(localProfile(), "logs")
	if e := os.MkdirAll(dir, 0700); e != nil {
		return ""
	}
	stamp := time.Now().UTC()
	name := fmt.Sprintf("setup-report-%s-%d.log", stamp.Format("20060102-150405"), os.Getpid())
	file := filepath.Join(dir, name)
	code, data := errorData(err)
	var b strings.Builder
	fmt.Fprintln(&b, "PulseDeck setup diagnostic report")
	fmt.Fprintln(&b, "This report may contain local file paths. It never contains music, passwords or library contents.")
	fmt.Fprintf(&b, "Timestamp UTC: %s\n", stamp.Format(time.RFC3339))
	fmt.Fprintf(&b, "PulseDeck version: %s\n", version)
	fmt.Fprintf(&b, "Mode: %s\n", mode)
	fmt.Fprintf(&b, "Platform: %s/%s (%s)\n", runtime.GOOS, runtime.GOARCH, runtime.Version())
	if target != "" {
		fmt.Fprintf(&b, "Target: %s\n", target)
	}
	fmt.Fprintf(&b, "Error code: %s\n", code)
	for _, key := range []string{"drive", "needed", "available", "status", "host", "component"} {
		if v := data[key]; v != "" {
			fmt.Fprintf(&b, "%s: %s\n", strings.Title(key), v)
		}
	}
	fmt.Fprintln(&b, "Error chain:")
	for depth, cause := 0, err; cause != nil && depth < 12; depth++ {
		fmt.Fprintf(&b, "  %d. %T: %v\n", depth+1, cause, cause)
		cause = errors.Unwrap(cause)
	}
	if e := os.WriteFile(file, []byte(b.String()), 0600); e != nil {
		return ""
	}
	// Keep a tiny chronological index for support while preserving the detailed
	// per-attempt report used by the UI's "Open report" button.
	summary := filepath.Join(dir, "setup.log")
	if f, e := os.OpenFile(summary, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600); e == nil {
		fmt.Fprintf(f, "%s %s %s report=%s\n", stamp.Format(time.RFC3339), code, err.Error(), filepath.Base(file))
		f.Close()
	}
	return file
}
