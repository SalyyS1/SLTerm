// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package vcs

import "os/exec"

func hideWindow(_ *exec.Cmd) {}
