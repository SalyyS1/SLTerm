// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package portwatch

import (
	"context"
	"os/exec"
	"strconv"
	"syscall"
)

const createNoWindow = 0x08000000

func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: createNoWindow,
	}
}

func terminatePID(ctx context.Context, pid int) error {
	_, err := runQuiet(ctx, "taskkill", "/PID", strconv.Itoa(pid), "/T", "/F")
	return err
}
