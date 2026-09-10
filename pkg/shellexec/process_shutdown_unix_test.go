// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

//go:build unix

package shellexec

import (
	"fmt"
	"os/exec"
	"syscall"
	"testing"
	"time"
)

func TestCmdWrapWaitCopiesObserveSameExitError(t *testing.T) {
	cmd := exec.Command("sh", "-c", "exit 23")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	wrap := MakeCmdWrap(cmd, nil, false)
	copy := wrap
	results := make(chan error, 2)
	go func() { results <- wrap.Wait() }()
	go func() { results <- copy.Wait() }()
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			t.Fatal("Wait returned nil for nonzero process exit")
		}
		if exitErr, ok := err.(*exec.ExitError); !ok || exitErr.ExitCode() != 23 {
			t.Fatalf("Wait returned %T %v, want exit code 23", err, err)
		}
	}
}

func TestCmdWrapKillGracefulTerminatesOwnedProcessGroupOnly(t *testing.T) {
	if testing.Short() {
		t.Skip("process integration test")
	}
	owned := exec.Command("sh", "-c", `trap '' HUP TERM; sh -c 'trap "" HUP TERM; while :; do sleep 1; done' & echo $!; wait`)
	owned.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, err := owned.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := owned.Start(); err != nil {
		t.Fatal(err)
	}
	var descendant int
	if _, err := fmt.Fscan(stdout, &descendant); err != nil {
		owned.Process.Kill()
		t.Fatal(err)
	}

	unrelated := exec.Command("sleep", "30")
	if err := unrelated.Start(); err != nil {
		owned.Process.Kill()
		t.Fatal(err)
	}
	defer unrelated.Process.Kill()

	wrap := MakeCmdWrap(owned, nil, false)
	wrap.KillGraceful(100 * time.Millisecond)
	done := make(chan error, 1)
	go func() { done <- wrap.Wait() }()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("owned process group was not reaped")
	}
	deadline := time.Now().Add(2 * time.Second)
	for processExists(descendant) && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if processExists(descendant) {
		t.Fatalf("owned descendant %d survived", descendant)
	}
	if err := unrelated.Process.Signal(syscall.Signal(0)); err != nil {
		t.Fatalf("unrelated same-name process was killed: %v", err)
	}
}

func processExists(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}
