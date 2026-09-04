// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build windows

package wshutil

import (
	"fmt"
	"net"
	"strings"

	"github.com/Microsoft/go-winio"
)

// PipeNameForSocket maps a filesystem socket path to a named-pipe name.
//
// The `wsh` CLI and the server agree on a *path* in the data dir, which is an
// AF_UNIX socket everywhere it works. Windows 10 1803+ does support AF_UNIX, but
// it is not universal: Server editions, older builds, and some managed images do
// not, and there the socket cannot be created at all. Named pipes have worked on
// every Windows since NT.
//
// The mapping is deterministic so both ends derive the same name from the same
// path without exchanging it: the path's separators and colon become dashes
// under the local pipe namespace. Deriving it rather than hardcoding a name is
// what keeps two data dirs — a normal install and one under SLTERM_DATA_HOME —
// from colliding on one pipe.
func PipeNameForSocket(sockPath string) string {
	cleaned := strings.NewReplacer(`\`, "-", "/", "-", ":", "-", " ", "-").Replace(sockPath)
	cleaned = strings.Trim(cleaned, "-")
	return `\\.\pipe\slterm-` + cleaned
}

// dialFallback connects over a named pipe when the unix socket could not be
// reached.
//
// Only used after both TCP and AF_UNIX have failed, so it costs nothing on a
// machine where AF_UNIX works.
func dialFallback(sockPath string) (net.Conn, error) {
	name := PipeNameForSocket(sockPath)
	conn, err := winio.DialPipe(name, nil)
	if err != nil {
		return nil, fmt.Errorf("named pipe %s: %w", name, err)
	}
	return conn, nil
}

// ListenFallback creates the named-pipe listener the server offers alongside its
// unix socket.
//
// Both are served: a `wsh` binary from an older install still speaks AF_UNIX,
// and one that cannot use AF_UNIX at all needs the pipe. The SDDL restricts the
// pipe to the creating user, matching the 0700 the unix socket is chmod'd to —
// without it a named pipe is reachable by every account on the machine, which
// would hand the wshrpc surface to any local user.
func ListenFallback(sockPath string) (net.Listener, error) {
	name := PipeNameForSocket(sockPath)
	cfg := &winio.PipeConfig{
		// D:P(A;;GA;;;OW) — DACL, protected, allow generic-all to the owner only.
		SecurityDescriptor: "D:P(A;;GA;;;OW)",
	}
	listener, err := winio.ListenPipe(name, cfg)
	if err != nil {
		return nil, fmt.Errorf("named pipe %s: %w", name, err)
	}
	return listener, nil
}
