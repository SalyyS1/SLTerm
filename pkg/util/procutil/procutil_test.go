// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package procutil

import (
	"os/exec"
	"testing"
)

func TestIsBatchShim(t *testing.T) {
	// A batch shim is not an executable image, so it cannot be spawned directly
	// and must go through cmd /C. Everything else is a real image and must not,
	// because cmd.exe would then interpret its arguments.
	batch := []string{
		`C:\Users\x\AppData\Roaming\npm\claude.cmd`,
		`C:\tools\build.BAT`,
		"npm.cmd",
	}
	for _, program := range batch {
		if !IsBatchShim(program) {
			t.Errorf("IsBatchShim(%q) = false, want true: a batch file cannot be exec'd directly", program)
		}
	}

	direct := []string{
		`C:\Program Files\Git\cmd\git.exe`,
		"git",
		"wsl.exe",
		"/usr/bin/git",
		// A path whose directory is named "cmd" is still an executable. Matching
		// on the extension rather than anywhere in the string is the difference.
		`C:\Program Files\Git\cmd\git`,
		// PowerShell scripts are not spawned by this app; powershell.exe is, and
		// it is a real image.
		"powershell.exe",
	}
	for _, program := range direct {
		if IsBatchShim(program) {
			t.Errorf("IsBatchShim(%q) = true, want false: routing a real executable through cmd.exe reopens argument injection", program)
		}
	}
}

func TestHideIsSafeOnAnyPlatform(t *testing.T) {
	// Hide is called unconditionally from cross-platform code, so it has to
	// tolerate every shape a caller might pass.
	cmd := exec.Command("echo", "hi")
	if got := Hide(cmd); got != cmd {
		t.Error("Hide should return the command it was given, so it can wrap a constructor call")
	}
	if Hide(nil) != nil {
		t.Error("Hide(nil) should return nil rather than panicking")
	}
}

func TestHideIsIdempotent(t *testing.T) {
	// Two layers both applying the rule is a realistic outcome of a sweep like
	// this, and must not corrupt the attributes.
	cmd := exec.Command("echo", "hi")
	Hide(cmd)
	first := cmd.SysProcAttr
	Hide(cmd)
	if cmd.SysProcAttr != first {
		t.Error("Hide should reuse the existing SysProcAttr rather than replacing it")
	}
}
