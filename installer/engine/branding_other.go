//go:build !windows

package main

func brandExecutable(file, version string) error { _, err := versionResource(version); return err }
