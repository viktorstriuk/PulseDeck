package main

import (
	"errors"
	"fmt"
	"sync"
	"testing"
)

func fakeEnumerator() (*windowEnumerator, *int) {
	count := new(int)
	var visit func(uintptr, uintptr) uintptr
	e := &windowEnumerator{register: func(f func(uintptr, uintptr) uintptr) uintptr { *count++; visit = f; return 123 }, inspect: func(h uintptr, c config) (candidate, bool) {
		return candidate{HWND: fmt.Sprint(h), Title: c.mode, Foreground: h == 1, Fullscreen: h%2 == 0}, h != c.overlay
	}}
	e.invoke = func(cb, token uintptr) error {
		if cb != 123 {
			panic("wrong thunk")
		}
		for h := uintptr(1); h <= 25; h++ {
			visit(h, token)
		}
		return nil
	}
	return e, count
}
func TestEnumeratorRegistersOnceAcross100000Polls(t *testing.T) {
	e, count := fakeEnumerator()
	for n := 0; n < 100000; n++ {
		c := config{mode: fmt.Sprint(n), overlay: 2}
		items, err := e.enumerate(c)
		if err != nil {
			t.Fatal(err)
		}
		if len(items) != 8 || !items[0].Foreground {
			t.Fatal("sort/cap changed")
		}
		for _, x := range items {
			if x.HWND == "2" || x.Title != c.mode {
				t.Fatal("stale per-call context")
			}
		}
		if len(e.contexts) != 0 {
			t.Fatal("leaked context")
		}
	}
	if *count != 1 {
		t.Fatalf("%d permanent callback registrations, want 1", *count)
	}
}
func TestEnumeratorConcurrentCallsRaceFree(t *testing.T) {
	e, count := fakeEnumerator()
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 1000; j++ {
				if _, err := e.enumerate(config{}); err != nil {
					t.Error(err)
				}
			}
		}()
	}
	wg.Wait()
	if *count != 1 || len(e.contexts) != 0 {
		t.Fatal("callback/context leak")
	}
}
func TestEnumerationFailureReleasesContext(t *testing.T) {
	e, count := fakeEnumerator()
	e.invoke = func(uintptr, uintptr) error { return errors.New("cancelled") }
	for i := 0; i < 3000; i++ {
		if _, err := e.enumerate(config{}); err == nil {
			t.Fatal("missing error")
		}
		if len(e.contexts) != 0 {
			t.Fatal("leak")
		}
	}
	if *count != 1 {
		t.Fatal("re-registered after failure")
	}
}
func TestLateCallbackDoesNotModifyCompletedResult(t *testing.T) {
	e, _ := fakeEnumerator()
	items, _ := e.enumerate(config{mode: "before"})
	count := len(items)
	if e.visit(100, e.token) != 1 || len(items) != count || len(e.contexts) != 0 {
		t.Fatal("late callback mutated a completed enumeration")
	}
}
