// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package updatecheck

import (
	"os/exec"
	"strings"
	"syscall"
)

const createNoWindow = 0x08000000

func launchInstaller(path string) error {
	args := []string{}
	if strings.Contains(strings.ToLower(path), "setup.exe") {
		// NSIS currentUser silent in-place upgrade
		args = append(args, "/S")
	}
	cmd := exec.Command(path, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
	return cmd.Start()
}
