// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package agentwatch implements SLTerm's cmux/Stella-inspired ADE Activity Feed &
// Agent State Transition Watcher. Detects when Claude Code or Codex sessions transition
// into `waiting_approval` or finish a long task, and records workspace actions (worktree
// creates/merges, session forks, security audits) with an unread counter for the status bar.
package agentwatch

import (
	"fmt"
	"sync"
	"time"

	"github.com/SalyyS1/SLTerm/pkg/agentsessions"
)

const maxEvents = 60

// ActivityEvent represents one notable ADE or AI-agent lifecycle notification.
type ActivityEvent struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`     // waiting_approval | agent_finished | worktree | security | system
	Severity  string `json:"severity"` // info | attention | warn
	Title     string `json:"title"`
	Detail    string `json:"detail,omitempty"`
	SessionID string `json:"sessionId,omitempty"`
	Cwd       string `json:"cwd,omitempty"`
	CreatedMs int64  `json:"createdMs"`
	Read      bool   `json:"read"`
}

// ActivityFeed is the snapshot returned to the frontend Status Bar & ADE Hub.
type ActivityFeed struct {
	UnreadCount  int             `json:"unreadCount"`
	WaitingCount int             `json:"waitingCount"`
	Events       []ActivityEvent `json:"events"`
}

// Hub maintains rolling events and previous session states safely across goroutines.
type Hub struct {
	mu           sync.Mutex
	seq          uint64
	events       []ActivityEvent
	lastStates   map[string]string // agent:id -> status
	waitingCount int
}

var defaultHub = NewHub()

// DefaultHub returns the process-wide ADE activity hub.
func DefaultHub() *Hub {
	return defaultHub
}

// NewHub constructs an isolated Hub (useful for unit tests).
func NewHub() *Hub {
	return &Hub{
		events:     make([]ActivityEvent, 0, 16),
		lastStates: make(map[string]string),
	}
}

// Record appends an ADE activity event to the rolling feed.
func (h *Hub) Record(kind, severity, title, detail, sessionID, cwd string) {
	if title == "" {
		return
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	h.recordLocked(kind, severity, title, detail, sessionID, cwd)
}

func (h *Hub) recordLocked(kind, severity, title, detail, sessionID, cwd string) {
	h.seq++
	ev := ActivityEvent{
		ID:        fmt.Sprintf("ev-%d-%d", time.Now().UnixMilli(), h.seq),
		Kind:      kind,
		Severity:  severity,
		Title:     title,
		Detail:    detail,
		SessionID: sessionID,
		Cwd:       cwd,
		CreatedMs: time.Now().UnixMilli(),
		Read:      false,
	}
	h.events = append([]ActivityEvent{ev}, h.events...)
	if len(h.events) > maxEvents {
		h.events = h.events[:maxEvents]
	}
}

// ObserveSessions compares the latest discovered sessions against previous states and
// emits notifications when an agent begins waiting on user approval or finishes work.
func (h *Hub) ObserveSessions(sessions []agentsessions.SessionSummary) {
	h.mu.Lock()
	defer h.mu.Unlock()
	waiting := 0
	for _, s := range sessions {
		if s.Status == "waiting_approval" {
			waiting++
		}
		key := s.Agent + ":" + s.ID
		prev, seen := h.lastStates[key]
		h.lastStates[key] = s.Status
		if !seen {
			if s.Status == "waiting_approval" {
				h.recordLocked(
					"waiting_approval",
					"attention",
					fmt.Sprintf("%s waiting for your approval", s.Agent),
					s.Title,
					s.ID,
					s.Cwd,
				)
			}
			continue
		}
		if prev != "waiting_approval" && s.Status == "waiting_approval" {
			h.recordLocked(
				"waiting_approval",
				"attention",
				fmt.Sprintf("%s needs approval", s.Agent),
				s.Title,
				s.ID,
				s.Cwd,
			)
		} else if prev == "active" && s.Status == "idle" {
			h.recordLocked(
				"agent_finished",
				"info",
				fmt.Sprintf("%s session finished / idle", s.Agent),
				s.Title,
				s.ID,
				s.Cwd,
			)
		}
	}
	h.waitingCount = waiting
}

// MarkAllRead marks all current events as read.
func (h *Hub) MarkAllRead() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for i := range h.events {
		h.events[i].Read = true
	}
}

// Snapshot returns a copy of the current activity feed.
func (h *Hub) Snapshot() ActivityFeed {
	h.mu.Lock()
	defer h.mu.Unlock()
	unread := 0
	out := make([]ActivityEvent, len(h.events))
	for i, ev := range h.events {
		if !ev.Read {
			unread++
		}
		out[i] = ev
	}
	return ActivityFeed{
		UnreadCount:  unread,
		WaitingCount: h.waitingCount,
		Events:       out,
	}
}
