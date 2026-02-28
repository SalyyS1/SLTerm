// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package petengine

import (
	"log"
	"sync"
	"time"
)

var (
	globalSession *SessionTracker
	sessionMu     sync.Mutex
)

// SessionTracker tracks the current coding session
type SessionTracker struct {
	mu       sync.RWMutex
	session  SessionData
	store    *PetStore
	stopChan chan struct{}
	lastXPAt time.Time
}

// GetSession returns the global session tracker
func GetSessionTracker() *SessionTracker {
	sessionMu.Lock()
	defer sessionMu.Unlock()
	if globalSession == nil {
		globalSession = NewSessionTracker(GetStore())
	}
	return globalSession
}

// NewSessionTracker creates and starts a new session tracker
func NewSessionTracker(store *PetStore) *SessionTracker {
	st := &SessionTracker{
		session: SessionData{
			StartedAt: time.Now(),
		},
		store:    store,
		stopChan: make(chan struct{}),
		lastXPAt: time.Now(),
	}

	// Check daily streak on startup
	store.CheckStreak()

	// Start background tickers
	go st.runTicker()

	return st
}

// GetSession returns a copy of the current session data
func (st *SessionTracker) GetSession() SessionData {
	st.mu.RLock()
	defer st.mu.RUnlock()
	return st.session
}

// OnCommand is called when a terminal command is executed
func (st *SessionTracker) OnCommand() {
	st.mu.Lock()
	st.session.CommandCount++
	st.session.IsIdle = false
	st.session.IdleSince = time.Time{}
	st.mu.Unlock()

	// Add XP for command
	st.store.AddXP(XPPerCommand)
	st.store.IncrementCommands()
}

// OnActivity marks the session as active (user typed/interacted)
func (st *SessionTracker) OnActivity() {
	st.mu.Lock()
	defer st.mu.Unlock()

	if st.session.IsIdle {
		st.session.IsIdle = false
		st.session.IdleSince = time.Time{}
		st.store.UpdateState(StateActive)
	}
}

// SetProject updates the current project name
func (st *SessionTracker) SetProject(project string) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.session.CurrentProject = project
}

// SetDiscordConnected updates the Discord connection status
func (st *SessionTracker) SetDiscordConnected(connected bool) {
	st.mu.Lock()
	defer st.mu.Unlock()
	st.session.DiscordConnected = connected
}

// Stop stops the session tracker
func (st *SessionTracker) Stop() {
	close(st.stopChan)
	// Final save
	st.store.Save()
}

// runTicker runs periodic checks (XP ticks, idle detection, auto-save)
func (st *SessionTracker) runTicker() {
	xpTicker := time.NewTicker(60 * time.Second)       // XP every minute
	idleTicker := time.NewTicker(10 * time.Second)     // Idle check every 10s
	saveTicker := time.NewTicker(30 * time.Second)     // Auto-save every 30s
	moodTicker := time.NewTicker(5 * 60 * time.Second) // Mood update every 5min

	defer xpTicker.Stop()
	defer idleTicker.Stop()
	defer saveTicker.Stop()
	defer moodTicker.Stop()

	for {
		select {
		case <-st.stopChan:
			return

		case <-xpTicker.C:
			st.mu.RLock()
			isIdle := st.session.IsIdle
			st.mu.RUnlock()

			if !isIdle {
				st.store.AddXP(XPPerMinute)
				st.mu.Lock()
				st.session.ActiveTime += 60
				st.mu.Unlock()
			}

		case <-idleTicker.C:
			st.mu.Lock()
			if !st.session.IsIdle && !st.session.IdleSince.IsZero() {
				elapsed := time.Since(st.session.IdleSince).Seconds()
				if elapsed >= float64(IdleTimeoutSec) {
					st.session.IsIdle = true
					st.store.UpdateState(StateSleeping)
				}
			}
			st.mu.Unlock()

		case <-saveTicker.C:
			if err := st.store.Save(); err != nil {
				log.Printf("pet: auto-save error: %v", err)
			}

		case <-moodTicker.C:
			st.store.UpdateMood()
		}
	}
}
