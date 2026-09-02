// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"fmt"
	"log"
	"os"
	"runtime/debug"

	"github.com/SalyyS1/SLTerm/pkg/waveserver"
)

// these are set at build time
var WaveVersion = "0.0.0"
var BuildTime = "0"

func main() {
	log.SetFlags(0) // disable timestamp since electron's winston logger already wraps with timestamp
	log.SetPrefix("[wavesrv] ")

	// GC tuning: reduce GC frequency for better throughput; GOMEMLIMIT caps memory
	debug.SetGCPercent(200)
	debug.SetMemoryLimit(512 * 1024 * 1024) // 512MB

	if BuildTime == "" {
		BuildTime = "0"
	}
	addrs, err := waveserver.Start(waveserver.Options{
		Version:   WaveVersion,
		BuildTime: BuildTime,
		// This binary is spawned as a child by the shell, which closes stdin to
		// say it is going away.
		WatchStdin: true,
	})
	if err != nil {
		log.Printf("[error] %v\n", err)
		return
	}
	// use fmt instead of log here to make sure it goes directly to stderr — the
	// shell parses this line to learn where to connect
	fmt.Fprintf(os.Stderr, "WAVESRV-ESTART ws:%s web:%s version:%s buildtime:%s\n", addrs.Ws, addrs.Web, WaveVersion, BuildTime)
	// The server runs in the background from here. Shutdown is handled by the
	// signal handlers and the stdin watch, both of which end the process.
	select {}
}
