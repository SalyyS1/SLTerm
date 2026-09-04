// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build !windows

package wshutil

import (
	"fmt"
	"net"
)

// There is no fallback transport off Windows: AF_UNIX is universal there, so a
// unix socket that fails to connect has a real reason and hiding it behind a
// second attempt would only obscure the error.
func dialFallback(_ string) (net.Conn, error) {
	return nil, fmt.Errorf("no fallback transport on this platform")
}

// ListenFallback exists so the server's listener setup needs no build tags of
// its own. Off Windows it declines, and the caller carries on with the unix
// socket alone.
func ListenFallback(_ string) (net.Listener, error) {
	return nil, fmt.Errorf("no fallback listener on this platform")
}
