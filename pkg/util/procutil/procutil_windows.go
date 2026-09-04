// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package procutil

import (
	"os/exec"
	"syscall"
)

// createNoWindow is CREATE_NO_WINDOW. Documented at
// learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags —
// the child runs without a console window of its own.
const createNoWindow = 0x08000000

func applyHide(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	// HideWindow alone only hides the window of a process that creates one;
	// CREATE_NO_WINDOW stops the console being allocated at all, which is what
	// prevents the brief flash.
	cmd.SysProcAttr.CreationFlags |= createNoWindow
}
