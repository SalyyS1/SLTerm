// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package blockcontroller

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/SalyyS1/SLTerm/pkg/waveobj"
)

type shutdownTestController struct {
	status  string
	stopped chan struct{}
	mu      sync.Mutex
	destroy bool
}

func (c *shutdownTestController) Start(context.Context, waveobj.MetaMapType, *waveobj.RuntimeOpts, bool) error {
	return nil
}
func (c *shutdownTestController) Stop(_ bool, _ string, destroy bool) {
	c.mu.Lock()
	c.destroy = destroy
	c.mu.Unlock()
	<-c.stopped
}
func (c *shutdownTestController) GetRuntimeStatus() *BlockControllerRuntimeStatus {
	return &BlockControllerRuntimeStatus{ShellProcStatus: c.status}
}
func (c *shutdownTestController) GetConnName() string              { return "" }
func (c *shutdownTestController) SendInput(*BlockInputUnion) error { return nil }

func TestShellControllerRunFailurePropagatesAndAllowsRetry(t *testing.T) {
	controller := &ShellController{
		Lock:           &sync.Mutex{},
		BlockId:        "startup-failure",
		ControllerType: "unknown",
		RunLock:        &atomic.Bool{},
	}
	block := &waveobj.Block{Meta: waveobj.MetaMapType{waveobj.MetaKey_Controller: "unknown"}}

	if err := controller.run(context.Background(), block, block.Meta, nil, false); err == nil {
		t.Fatal("run returned nil for invalid controller startup")
	}
	if err := controller.run(context.Background(), block, block.Meta, nil, false); err == nil {
		t.Fatal("retry returned nil for invalid controller startup")
	}
	if controller.RunLock.Load() {
		t.Fatal("run lock remained held after startup failures")
	}
}

func TestStopControllerSnapshotAwaitsRunningControllers(t *testing.T) {
	controller := &shutdownTestController{status: Status_Running, stopped: make(chan struct{})}
	deleted := make(chan string, 1)
	done := make(chan error, 1)
	go func() {
		done <- stopControllerSnapshot(context.Background(), map[string]Controller{"owned": controller}, func(id string) {
			deleted <- id
		})
	}()
	select {
	case <-done:
		t.Fatal("shutdown returned before controller completed")
	case <-time.After(20 * time.Millisecond):
	}
	close(controller.stopped)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if id := <-deleted; id != "owned" {
		t.Fatalf("deleted runtime info for %q", id)
	}
	controller.mu.Lock()
	defer controller.mu.Unlock()
	if !controller.destroy {
		t.Fatal("shutdown did not terminate durable ownership")
	}
}

func TestStopControllerSnapshotHonorsDeadline(t *testing.T) {
	controller := &shutdownTestController{status: Status_Running, stopped: make(chan struct{})}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	if err := stopControllerSnapshot(ctx, map[string]Controller{"blocked": controller}, func(string) {}); err == nil {
		t.Fatal("expected shutdown deadline error")
	}
	close(controller.stopped)
}
