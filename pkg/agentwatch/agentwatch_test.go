// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package agentwatch

import (
	"testing"

	"github.com/SalyyS1/SLTerm/pkg/agentsessions"
)

func TestObserveSessionTransitionsAndMarkRead(t *testing.T) {
	h := NewHub()

	// Initial observation: active session (no spam event)
	h.ObserveSessions([]agentsessions.SessionSummary{
		{ID: "s1", Agent: "claude", Title: "Build Rem Aqua UI", Status: "active", Cwd: "/work/slterm"},
	})
	snap := h.Snapshot()
	if snap.UnreadCount != 0 || snap.WaitingCount != 0 {
		t.Fatalf("expected 0 events on initial active session, got %+v", snap)
	}

	// Transition active -> waiting_approval MUST trigger an attention event
	h.ObserveSessions([]agentsessions.SessionSummary{
		{ID: "s1", Agent: "claude", Title: "Build Rem Aqua UI", Status: "waiting_approval", Cwd: "/work/slterm"},
	})
	snap2 := h.Snapshot()
	if snap2.UnreadCount != 1 || snap2.WaitingCount != 1 || snap2.Events[0].Kind != "waiting_approval" {
		t.Fatalf("expected waiting_approval event, got %+v", snap2)
	}

	// Transition active -> idle triggers agent_finished
	h.ObserveSessions([]agentsessions.SessionSummary{
		{ID: "s2", Agent: "codex", Title: "Run tests", Status: "active"},
	})
	h.ObserveSessions([]agentsessions.SessionSummary{
		{ID: "s2", Agent: "codex", Title: "Run tests", Status: "idle"},
	})
	snap3 := h.Snapshot()
	if snap3.UnreadCount != 2 || snap3.Events[0].Kind != "agent_finished" {
		t.Fatalf("expected agent_finished event, got %+v", snap3)
	}

	h.MarkAllRead()
	snap4 := h.Snapshot()
	if snap4.UnreadCount != 0 {
		t.Fatalf("expected 0 unread after MarkAllRead, got %+v", snap4)
	}
}
