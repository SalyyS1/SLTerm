// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package shellexec

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/SalyyS1/SLTerm/pkg/util/shellutil"
	"github.com/SalyyS1/SLTerm/pkg/wavebase"
	"github.com/SalyyS1/SLTerm/pkg/waveobj"
)

// startTestShell brings up a real PTY-backed /bin/sh the way a terminal block
// does. Data/config dirs are redirected into the test's temp dir so the shell
// startup files this writes never touch the developer's real ~/.slterm.
func startTestShell(t *testing.T) *ShellProc {
	t.Helper()
	home := t.TempDir()
	t.Setenv("SLTERM_DATA_HOME", home+"/data")
	t.Setenv("SLTERM_CONFIG_HOME", home+"/config")
	// wavebase caches these into package vars at startup rather than reading the
	// environment per call, so without this the data dir is "" and the shell
	// startup files land relative to the package directory — polluting the source
	// tree instead of the temp dir.
	if err := wavebase.CacheAndRemoveEnvVars(); err != nil {
		t.Fatalf("CacheAndRemoveEnvVars: %v", err)
	}
	if os.Getenv("SHELL") == "" {
		t.Setenv("SHELL", "/bin/sh")
	}
	sp, err := StartLocalShellProc(context.Background(),
		waveobj.TermSize{Rows: 24, Cols: 80},
		"", // empty command means "start the shell itself"
		CommandOptsType{
			Interactive: true,
			ShellPath:   "/bin/sh",
			// Required by StartLocalShellProc; the shell-integration handshake
			// is not what these tests are about, so a bare token is enough.
			SwapToken: &shellutil.TokenSwapEntry{Token: "test-token"},
		},
		"local")
	if err != nil {
		t.Fatalf("StartLocalShellProc: %v", err)
	}
	t.Cleanup(sp.Close)
	return sp
}

// TestLocalShellRoundTrip is the end-to-end check that the terminal actually
// works: start a real PTY-backed shell the way a terminal block does, type a
// command into it, and read the output back.
//
// Everything above this layer (block controller, WPS events, xterm) is plumbing
// around this. If this passes, a shell runs and its output flows.
func TestLocalShellRoundTrip(t *testing.T) {
	sp := startTestShell(t)

	// A PTY echoes what is typed, so look for a marker only the command's output
	// can produce rather than matching the command text itself.
	const marker = "SLTERM_PTY_OK_7f3a"
	if _, err := sp.Cmd.Write([]byte("printf '%s\\n' " + marker + "\n")); err != nil {
		t.Fatalf("write to shell: %v", err)
	}

	var buf bytes.Buffer
	found := make(chan bool, 1)
	go func() {
		chunk := make([]byte, 4096)
		for {
			n, err := sp.Cmd.Read(chunk)
			if n > 0 {
				buf.Write(chunk[:n])
				// The echoed input line contains "printf", the produced output
				// line does not — so require a marker occurrence that is not on
				// a line mentioning printf.
				for _, line := range strings.Split(buf.String(), "\n") {
					if strings.Contains(line, marker) && !strings.Contains(line, "printf") {
						found <- true
						return
					}
				}
			}
			if err != nil {
				found <- false
				return
			}
		}
	}()

	select {
	case ok := <-found:
		if !ok {
			t.Fatalf("shell stdout closed before the marker appeared; got:\n%s", buf.String())
		}
	case <-time.After(20 * time.Second):
		t.Fatalf("timed out waiting for shell output; got:\n%s", buf.String())
	}

	t.Logf("shell produced the marker on its own output line (%d bytes read)", buf.Len())
}

// TestLocalShellResize exercises the path a terminal uses on every window
// resize. A PTY that rejects SetSize would make the terminal reflow wrongly.
func TestLocalShellResize(t *testing.T) {
	sp := startTestShell(t)

	for _, size := range []struct{ w, h int }{{120, 30}, {80, 24}, {200, 50}} {
		if err := sp.Cmd.SetSize(size.w, size.h); err != nil {
			t.Errorf("SetSize(%d,%d): %v", size.w, size.h, err)
		}
	}
}

// TestLocalShellExitIsObservable covers the other half of the lifecycle: the
// controller has to learn when a shell exits, or a finished terminal keeps
// looking alive.
func TestLocalShellExitIsObservable(t *testing.T) {
	sp := startTestShell(t)

	if _, err := sp.Cmd.Write([]byte("exit 3\n")); err != nil {
		t.Fatalf("write exit: %v", err)
	}

	// Drain the pty so the shell is never blocked writing while it exits.
	go func() {
		buf := make([]byte, 4096)
		for {
			if _, err := sp.Cmd.Read(buf); err != nil {
				return
			}
		}
	}()

	go func() {
		sp.WaitErr = sp.Cmd.Wait()
		close(sp.DoneCh)
	}()

	select {
	case <-sp.DoneCh:
		if code := sp.Cmd.ExitCode(); code != 3 {
			t.Errorf("exit code: got %d, want 3", code)
		}
	case <-time.After(20 * time.Second):
		sp.Close()
		t.Fatal("shell did not exit within 20s")
	}
}
