//go:build !windows

// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package sigutil

import (
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/SalyyS1/SLTerm/pkg/panichandler"
	"github.com/SalyyS1/SLTerm/pkg/util/utilfn"
)

const DumpFilePath = "/tmp/slterm-usr1-dump.log"

func InstallSIGUSR1Handler() {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGUSR1)
	go func() {
		defer func() {
			panichandler.PanicHandler("InstallSIGUSR1Handler", recover())
		}()
		for range sigCh {
			file, err := os.Create(DumpFilePath)
			if err != nil {
				log.Printf("error creating dump file %q: %v", DumpFilePath, err)
				continue
			}
			utilfn.DumpGoRoutineStacks(file)
			file.Close()
		}
	}()
}
