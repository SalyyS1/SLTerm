// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"github.com/SalyyS1/SLTerm/cmd/wsh/cmd"
	"github.com/SalyyS1/SLTerm/pkg/wavebase"
)

// set by main-server.go
var WaveVersion = "0.0.0"
var BuildTime = "0"

func main() {
	wavebase.WaveVersion = WaveVersion
	wavebase.BuildTime = BuildTime
	cmd.Execute()
}
