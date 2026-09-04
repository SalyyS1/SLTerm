// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package procutil holds the rules for spawning a child process that this app
// applies everywhere, so they exist in one place rather than being remembered at
// each call site.
//
// Two rules, both about Windows, both invisible on Linux and macOS:
//
//  1. No console window. A GUI process spawning a console program on Windows
//     gets a console window unless it asks not to. Every `git`, `wsl.exe`,
//     `powershell` and version probe this app runs would flash one — which on a
//     Windows-first product is the most visible defect a user can see.
//
//  2. Direct exec for real executables, `cmd /C` only for batch shims. Routing a
//     real `.exe` through `cmd.exe` hands its arguments to a command
//     interpreter, and cmd metacharacters (`& | ( ) ^ !`) in a branch name, a
//     file path or a remote name — all of which can come from a repository this
//     app did not create — then break out into command execution. Go's
//     `os/exec` passes arguments as literal argv elements and never invokes a
//     shell, so a direct spawn closes that whole family. The inverse is also
//     true and less obvious: a `.cmd`/`.bat` shim is *not* an executable image
//     and cannot be spawned directly at all, so those have to go through
//     `cmd /C`. Which is why this is a rule about matching the target, not a
//     preference for one mechanism.
package procutil

import (
	"os/exec"
	"path/filepath"
	"strings"
)

// Hide suppresses the console window a child process would otherwise create.
//
// Call it on any command built for a program that is not attached to a PTY.
// A no-op off Windows, so call sites need no build tags of their own.
func Hide(cmd *exec.Cmd) *exec.Cmd {
	if cmd == nil {
		return cmd
	}
	applyHide(cmd)
	return cmd
}

// IsBatchShim reports whether a program must be run through cmd.exe.
//
// Windows batch files and PowerShell scripts are not executable images: the
// loader cannot start them, so `exec.Command` on one fails outright. npm, npx,
// yarn and the Claude and Codex CLIs all install as `.cmd` shims, which is why
// this case exists at all.
//
// Everything else — anything with no extension, and every `.exe`/`.com` — is a
// real image and must be spawned directly.
func IsBatchShim(program string) bool {
	switch strings.ToLower(filepath.Ext(program)) {
	case ".cmd", ".bat":
		return true
	default:
		return false
	}
}
