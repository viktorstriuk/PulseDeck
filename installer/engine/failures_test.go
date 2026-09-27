package main

import (
	"context"
	"errors"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

func TestSetupFailureClassification(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"timeout", context.DeadlineExceeded, "SetupErrorNetworkTimeout"},
		{"dns", &net.DNSError{Err: "no such host", Name: "example.test"}, "SetupErrorNetworkDNS"},
		{"permission", &os.PathError{Op: "open", Path: "x", Err: syscall.Errno(5)}, "SetupErrorPermissions"},
		{"disk full", &os.PathError{Op: "write", Path: "x", Err: syscall.Errno(112)}, "SetupErrorDisk"},
		{"sharing", &os.PathError{Op: "rename", Path: "x", Err: syscall.Errno(32)}, "SetupErrorLocked"},
		{"security", &os.PathError{Op: "exec", Path: "x", Err: syscall.Errno(225)}, "SetupErrorSecuritySoftware"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := errorCode(tc.err); got != tc.want {
				t.Fatalf("got %s want %s", got, tc.want)
			}
		})
	}
}

func TestHTTPFailureClassification(t *testing.T) {
	cases := map[int]string{403: "SetupErrorSourceDenied", 404: "SetupErrorSourceMissing", 407: "SetupErrorProxyAuth", 408: "SetupErrorNetworkTimeout", 429: "SetupErrorRateLimited", 500: "SetupErrorServer", 418: "SetupErrorNetworkHTTP"}
	for status, want := range cases {
		if got := errorCode(httpFailure(status, "https://github.com/example/file")); got != want {
			t.Fatalf("HTTP %d got %s want %s", status, got, want)
		}
	}
}

func TestTypedNetworkFailureSurvivesComponentContext(t *testing.T) {
	original := setupFail("SetupErrorSourceMissing", errors.New("HTTP 404"), map[string]string{"component": "ytdlp", "status": "404"})
	wrapped := errors.New("SETUP_COMPONENTS: wrapper")
	wrapped = annotateFailure(original, "component", "ytdlp")
	code, data := errorData(wrapped)
	if code != "SetupErrorSourceMissing" || data["component"] != "ytdlp" || data["status"] != "404" {
		t.Fatal(code, data)
	}
}

func TestDiagnosticReportIsPrivateAndActionable(t *testing.T) {
	root := t.TempDir()
	t.Setenv("LOCALAPPDATA", root)
	t.Setenv("APPDATA", root)
	err := setupFail("SetupErrorSourceMissing", errors.New("HTTP 404 fixture"), map[string]string{"status": "404", "host": "github.com"})
	report := diagnosticReport(err, filepath.Join(root, "PulseDeck"), "2.9.3-beta.5", "install")
	if report == "" {
		t.Fatal("report missing")
	}
	if !strings.HasPrefix(filepath.Clean(report), filepath.Join(root, "PulseDeck", "logs")) {
		t.Fatal(report)
	}
	data, e := os.ReadFile(report)
	if e != nil {
		t.Fatal(e)
	}
	text := string(data)
	for _, want := range []string{"SetupErrorSourceMissing", "HTTP 404 fixture", "github.com", "2.9.3-beta.5"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q", want)
		}
	}
	if strings.Contains(strings.ToLower(text), "password") && !strings.Contains(text, "never contains") {
		t.Fatal("unexpected secret")
	}
}
