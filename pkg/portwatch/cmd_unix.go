// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package portwatch

import "os/exec"

func hideWindow(cmd *exec.Cmd) {
	// No console window flash on Unix platforms.
}
