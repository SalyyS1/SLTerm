// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package procutil

import "os/exec"

// No console windows exist off Windows, so there is nothing to suppress. This
// exists so call sites can apply the rule unconditionally instead of carrying
// build tags of their own.
func applyHide(_ *exec.Cmd) {}
