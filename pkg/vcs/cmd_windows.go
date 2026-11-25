// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package vcs

import (
	"os/exec"
	"syscall"
)

// hideWindow suppresses black console flashes when invoking git from the Tauri desktop app on Windows.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}
