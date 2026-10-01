package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

func applicationEnvironment(env []string) []string {
	out := make([]string, 0, len(env))
	for _, s := range env {
		key := strings.ToUpper(strings.SplitN(s, "=", 2)[0])
		switch key {
		case "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ASAR", "NODE_OPTIONS", "NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE":
			continue
		}
		out = append(out, s)
	}
	return out
}
func launchApplication(ctx context.Context, target, version string) error {
	target, err := filepath.Abs(target)
	if err != nil {
		return err
	}
	exe := filepath.Join(target, "PulseDeck.exe")
	info, err := os.Stat(exe)
	if err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("SETUP_LAUNCH: executable is missing")
	}
	nonce := make([]byte, 24)
	if _, err = rand.Read(nonce); err != nil {
		return err
	}
	token := hex.EncodeToString(nonce)
	dir := filepath.Join(localProfile(), "launch")
	if err = os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	ack := filepath.Join(dir, token+".json")
	defer os.Remove(ack)
	args := []string{"--pulsedeck-launch-token=" + token}
	cmd := exec.Command(exe, args...)
	cmd.Dir = target
	cmd.Env = applicationEnvironment(os.Environ())
	detachApplication(cmd)
	if err = cmd.Start(); err != nil {
		return fmt.Errorf("SETUP_LAUNCH: %w", err)
	}
	exited := make(chan error, 1)
	go func() { exited <- cmd.Wait() }()
	deadline := time.Now().Add(25 * time.Second)
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return err
		}
		if st, e := os.Lstat(ack); e == nil && st.Mode().IsRegular() && st.Size() < 4096 {
			b, e := os.ReadFile(ack)
			var ready struct{ Token, Version, Exe string }
			if e == nil && json.Unmarshal(b, &ready) == nil && ready.Token == token && strings.EqualFold(ready.Exe, exe) && ready.Version == version {
				return nil
			}
		}
		select {
		case e := <-exited:
			if e != nil {
				return fmt.Errorf("SETUP_LAUNCH: %w", e)
			}
		default:
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("SETUP_LAUNCH_TIMEOUT: PulseDeck did not acknowledge a visible window")
}

// "done" means the application has acknowledged a visible window, not merely
// that CreateProcess returned. The splash stays alive for retry/report on error.
func finishApplicationUpdate(ctx context.Context, target, version string, restart bool, notify func(Event)) error {
	if restart {
		notify(Event{Phase: "launching", Percent: 100, Target: target})
		if err := launchApplication(ctx, target, version); err != nil {
			return err
		}
	}
	notify(Event{Phase: "done", Percent: 100, Target: target})
	return nil
}
