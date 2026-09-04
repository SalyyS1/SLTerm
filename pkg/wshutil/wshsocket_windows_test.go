// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package wshutil

import "testing"

func TestPipeNameForSocket(t *testing.T) {
	// Both ends derive the pipe name from the same socket path without
	// exchanging it, so the mapping has to be stable and total: every character
	// a Windows path can contain must produce a legal pipe name.
	cases := []struct {
		in   string
		want string
	}{
		{`C:\Users\salyvn\.slterm\data\wave.sock`, `\\.\pipe\slterm-C-Users-salyvn-.slterm-data-wave.sock`},
		{`C:/Users/x/.slterm/data/wave.sock`, `\\.\pipe\slterm-C-Users-x-.slterm-data-wave.sock`},
		// A path with spaces is ordinary on Windows and must not produce a name
		// with spaces in it.
		{`C:\Program Files\SLTerm\wave.sock`, `\\.\pipe\slterm-C-Program-Files-SLTerm-wave.sock`},
	}
	for _, c := range cases {
		if got := PipeNameForSocket(c.in); got != c.want {
			t.Errorf("PipeNameForSocket(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestPipeNameIsDistinctPerDataDir(t *testing.T) {
	// Two data dirs — a normal install and one under SLTERM_DATA_HOME — must not
	// collide on one pipe, or the second server silently fails to listen and
	// every wsh in that install talks to the wrong server.
	a := PipeNameForSocket(`C:\Users\x\.slterm\data\wave.sock`)
	b := PipeNameForSocket(`C:\tmp\other\data\wave.sock`)
	if a == b {
		t.Errorf("distinct data dirs produced the same pipe name: %q", a)
	}
}
