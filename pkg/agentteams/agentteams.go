// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package agentteams is a read model over the on-disk state that Claude Code
// writes when it runs a multi-agent team: the team roster and the shared task
// board.
//
// This package deliberately does not create, mutate or kill teams. It observes
// what a running session has already decided, the same way a build dashboard
// observes CI. Controlling agents from the UI would be a different feature with
// a different risk profile.
//
// Everything read here is an undocumented private layout. Parse failures are
// collected as warnings rather than swallowed, so a format drift surfaces as a
// visible degraded state instead of an empty panel that looks like "no teams".
package agentteams

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Member is one agent in a team. Field names follow the on-disk JSON, which is
// written by Claude Code and is not ours to rename.
type Member struct {
	AgentID   string `json:"agentId"`
	Name      string `json:"name"`
	AgentType string `json:"agentType"`
	Model     string `json:"model,omitempty"`
	JoinedAt  int64  `json:"joinedAt,omitempty"`
	Cwd       string `json:"cwd,omitempty"`
}

// Config is a team's roster as stored in <team>/config.json.
type Config struct {
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	CreatedAt   int64    `json:"createdAt,omitempty"`
	LeadAgentID string   `json:"leadAgentId,omitempty"`
	Members     []Member `json:"members"`
}

// Task is one entry on a team's task board.
type Task struct {
	ID         string   `json:"id"`
	Subject    string   `json:"subject"`
	Status     string   `json:"status"`
	Owner      string   `json:"owner,omitempty"`
	BlockedBy  []string `json:"blockedBy,omitempty"`
	ActiveForm string   `json:"activeForm,omitempty"`
}

// Team pairs a roster with its task board.
type Team struct {
	// DirName is the directory the team lives in, which is how tasks are
	// addressed. It is not always equal to Config.Name.
	DirName string `json:"dirname"`
	Config  Config `json:"config"`
	Tasks   []Task `json:"tasks"`
}

// Snapshot is everything visible at one instant.
type Snapshot struct {
	Teams []Team `json:"teams"`
	// Warnings is non-empty when something existed but could not be read or
	// parsed. Warnings with no Teams means the format drifted; no Warnings and
	// no Teams means the user simply has no active teams.
	Warnings []string `json:"warnings,omitempty"`
}

// ErrInvalidTeamName is returned for a team name that is not a single safe path
// segment. The name reaches us from the UI and is joined into a filesystem
// path, so it is an arbitrary-file-read vector if left unchecked.
var ErrInvalidTeamName = fmt.Errorf("team name must be a single path segment")

func validateTeamName(name string) error {
	if name == "" || name == "." || name == ".." {
		return ErrInvalidTeamName
	}
	if strings.ContainsAny(name, `/\`) || strings.ContainsRune(name, 0) {
		return ErrInvalidTeamName
	}
	if filepath.Base(name) != name {
		return ErrInvalidTeamName
	}
	return nil
}

func claudeHome() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory: %w", err)
	}
	return filepath.Join(home, ".claude"), nil
}

// ReadTasks returns one team's task board, sorted so blocked work sinks and
// in-progress work rises — the order someone scanning the board wants.
func ReadTasks(teamName string) ([]Task, error) {
	if err := validateTeamName(teamName); err != nil {
		return nil, err
	}
	root, err := claudeHome()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(root, "tasks", teamName)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("cannot read task dir for %q: %w", teamName, err)
	}
	var tasks []Task
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		var task Task
		if err := json.Unmarshal(raw, &task); err != nil {
			continue
		}
		if task.ID == "" {
			task.ID = strings.TrimSuffix(entry.Name(), ".json")
		}
		tasks = append(tasks, task)
	}
	rank := func(status string) int {
		switch strings.ToLower(status) {
		case "in_progress":
			return 0
		case "pending":
			return 1
		case "completed":
			return 2
		default:
			return 3
		}
	}
	sort.SliceStable(tasks, func(i, j int) bool {
		ri, rj := rank(tasks[i].Status), rank(tasks[j].Status)
		if ri != rj {
			return ri < rj
		}
		return tasks[i].ID < tasks[j].ID
	})
	return tasks, nil
}

// ReadSnapshot enumerates every team under ~/.claude/teams together with its
// task board.
func ReadSnapshot() (*Snapshot, error) {
	snap := &Snapshot{}
	warn := func(msg string) { snap.Warnings = append(snap.Warnings, msg) }

	root, err := claudeHome()
	if err != nil {
		return nil, err
	}
	teamsDir := filepath.Join(root, "teams")
	entries, err := os.ReadDir(teamsDir)
	if err != nil {
		// No teams directory is the normal state for someone who has never run
		// a team; it is not a warning.
		if os.IsNotExist(err) {
			return snap, nil
		}
		return nil, fmt.Errorf("cannot read %s: %w", teamsDir, err)
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		configPath := filepath.Join(teamsDir, entry.Name(), "config.json")
		raw, err := os.ReadFile(configPath)
		if err != nil {
			if !os.IsNotExist(err) {
				warn(fmt.Sprintf("cannot read %s: %v", configPath, err))
			}
			continue
		}
		var cfg Config
		if err := json.Unmarshal(raw, &cfg); err != nil {
			warn(fmt.Sprintf("cannot parse %s: %v", configPath, err))
			continue
		}
		if cfg.Name == "" {
			cfg.Name = entry.Name()
		}
		tasks, err := ReadTasks(entry.Name())
		if err != nil {
			warn(fmt.Sprintf("cannot read tasks for %q: %v", entry.Name(), err))
		}
		snap.Teams = append(snap.Teams, Team{
			DirName: entry.Name(),
			Config:  cfg,
			Tasks:   tasks,
		})
	}
	sort.Slice(snap.Teams, func(i, j int) bool { return snap.Teams[i].DirName < snap.Teams[j].DirName })
	return snap, nil
}
