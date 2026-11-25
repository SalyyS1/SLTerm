// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package updatecheck

import (
	"os/exec"
	"runtime"
)

func launchInstaller(path string) error {
	bin := "xdg-open"
	if runtime.GOOS == "darwin" {
		bin = "open"
	}
	return exec.Command(bin, path).Start()
}
