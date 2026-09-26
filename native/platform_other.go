//go:build !windows

package main

import "errors"

type unsupportedPlatform struct{}

func newPlatform() hostPlatform { return unsupportedPlatform{} }
func (unsupportedPlatform) acquireMutex() (func(), error) {
	return nil, errors.New("Windows is required")
}
func (unsupportedPlatform) enumerate(config) ([]candidate, error) { return nil, nil }
func (unsupportedPlatform) reinforce(uintptr) bool                { return false }
func (unsupportedPlatform) outputSize(uintptr) (uint32, uint32)   { return 0, 0 }
func (unsupportedPlatform) openRTSS() (*rtssClient, error) {
	return nil, errors.New("Windows is required")
}
