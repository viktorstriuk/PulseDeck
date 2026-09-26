//go:build !windows

package main

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"time"
)

func hideProcess(c *exec.Cmd)                                               {}
func replaceAtomic(src, dst string) error                                   { return os.Rename(src, dst) }
func enoughSpace(path string, needed uint64) bool                           { return true }
func processAlive(pid int) bool                                             { return pid == os.Getpid() }
func processAt(target string) bool                                          { return false }
func waitProcess(ctx context.Context, pid int, timeout time.Duration) error { return nil }
func registerApplication(target, version string) error                      { return nil }
func unregisterApplication(target string)                                   {}
func createAppShortcut(target string) error                                 { return nil }
func showSplash(p *Package, words map[string]string, work func(context.Context, func(Event)) error) error {
	return work(context.Background(), func(e Event) {})
}

func preferredUILanguages() []string {
	for _, key := range []string{"LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"} {
		if value := os.Getenv(key); value != "" {
			parts := strings.Split(value, ":")
			for i, part := range parts {
				parts[i] = strings.Split(part, ".")[0]
			}
			return parts
		}
	}
	return []string{"en"}
}
