// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package taskboard implements SLTerm's lightweight Mini-Kanban Task Board inspired by
// Vibe Kanban & dmux. Tasks persist locally at ~/.slterm/config/ade-tasks.json and link
// cleanly to isolated Git worktrees + agent branches (`feat/<slug>`).
package taskboard

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// TaskStatus enumerates Kanban columns.
type TaskStatus string

const (
	StatusTodo       TaskStatus = "todo"
	StatusInProgress TaskStatus = "in_progress"
	StatusReview     TaskStatus = "review"
	StatusDone       TaskStatus = "done"
)

// TaskItem represents one Kanban task card that can be dispatched to an agent worktree.
type TaskItem struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Description  string `json:"description,omitempty"`
	Status       string `json:"status"`   // todo | in_progress | review | done
	Agent        string `json:"agent"`    // claude | codex | gemini | any
	Priority     string `json:"priority"` // low | medium | high
	Branch       string `json:"branch,omitempty"`
	RepoDir      string `json:"repoDir,omitempty"`
	WorktreePath string `json:"worktreePath,omitempty"`
	CreatedAtMs  int64  `json:"createdAtMs"`
	UpdatedAtMs  int64  `json:"updatedAtMs"`
}

var (
	boardMu    sync.Mutex
	nonSlugRe  = regexp.MustCompile(`[^a-z0-9]+`)
)

func boardFilePath() string {
	base := strings.TrimSpace(os.Getenv("SLTERM_CONFIG_HOME"))
	if base == "" {
		h, _ := os.UserHomeDir()
		base = filepath.Join(h, ".slterm", "config")
	}
	return filepath.Join(base, "ade-tasks.json")
}

func normalizeStatus(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case string(StatusInProgress):
		return string(StatusInProgress)
	case string(StatusReview):
		return string(StatusReview)
	case string(StatusDone):
		return string(StatusDone)
	default:
		return string(StatusTodo)
	}
}

func normalizePriority(p string) string {
	switch strings.ToLower(strings.TrimSpace(p)) {
	case "high":
		return "high"
	case "low":
		return "low"
	default:
		return "medium"
	}
}

// SlugifyBranch turns a human task title into a safe Git branch name `feat/<slug>`.
func SlugifyBranch(title string) string {
	s := strings.ToLower(strings.TrimSpace(title))
	s = nonSlugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if len(s) > 36 {
		s = strings.TrimRight(s[:36], "-")
	}
	if s == "" {
		s = "task"
	}
	return "feat/" + s
}

func randomID() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return "task-" + hex.EncodeToString(b[:])
}

func loadUnlocked() ([]TaskItem, error) {
	raw, err := os.ReadFile(boardFilePath())
	if err != nil {
		if os.IsNotExist(err) {
			return []TaskItem{}, nil
		}
		return nil, err
	}
	var tasks []TaskItem
	if err := json.Unmarshal(raw, &tasks); err != nil {
		return []TaskItem{}, nil
	}
	sort.Slice(tasks, func(i, j int) bool {
		return tasks[i].UpdatedAtMs > tasks[j].UpdatedAtMs
	})
	return tasks, nil
}

func saveUnlocked(tasks []TaskItem) error {
	p := boardFilePath()
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(tasks, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// ListTasks returns all persisted Kanban tasks ordered by most recently updated.
func ListTasks() ([]TaskItem, error) {
	boardMu.Lock()
	defer boardMu.Unlock()
	return loadUnlocked()
}

// SaveTask creates or updates a Kanban task card.
func SaveTask(item TaskItem) (*TaskItem, error) {
	item.Title = strings.TrimSpace(item.Title)
	if item.Title == "" {
		return nil, errors.New("task title is required")
	}
	item.Status = normalizeStatus(item.Status)
	item.Priority = normalizePriority(item.Priority)
	if strings.TrimSpace(item.Agent) == "" {
		item.Agent = "claude"
	}
	if strings.TrimSpace(item.Branch) == "" {
		item.Branch = SlugifyBranch(item.Title)
	}
	now := time.Now().UnixMilli()

	boardMu.Lock()
	defer boardMu.Unlock()
	tasks, err := loadUnlocked()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(item.ID) == "" {
		item.ID = randomID()
		item.CreatedAtMs = now
		item.UpdatedAtMs = now
		tasks = append([]TaskItem{item}, tasks...)
	} else {
		found := false
		for i := range tasks {
			if tasks[i].ID == item.ID {
				item.CreatedAtMs = tasks[i].CreatedAtMs
				if item.CreatedAtMs == 0 {
					item.CreatedAtMs = now
				}
				item.UpdatedAtMs = now
				tasks[i] = item
				found = true
				break
			}
		}
		if !found {
			item.CreatedAtMs = now
			item.UpdatedAtMs = now
			tasks = append([]TaskItem{item}, tasks...)
		}
	}
	if err := saveUnlocked(tasks); err != nil {
		return nil, err
	}
	cp := item
	return &cp, nil
}

// MoveTask transitions a task to a new Kanban column and optionally records its worktree path.
func MoveTask(id, status, worktreePath string) (*TaskItem, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, errors.New("task id is required")
	}
	boardMu.Lock()
	defer boardMu.Unlock()
	tasks, err := loadUnlocked()
	if err != nil {
		return nil, err
	}
	for i := range tasks {
		if tasks[i].ID == id {
			tasks[i].Status = normalizeStatus(status)
			if strings.TrimSpace(worktreePath) != "" {
				tasks[i].WorktreePath = strings.TrimSpace(worktreePath)
			}
			tasks[i].UpdatedAtMs = time.Now().UnixMilli()
			if err := saveUnlocked(tasks); err != nil {
				return nil, err
			}
			cp := tasks[i]
			return &cp, nil
		}
	}
	return nil, errors.New("task not found")
}

// DeleteTask removes a task by ID.
func DeleteTask(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("task id is required")
	}
	boardMu.Lock()
	defer boardMu.Unlock()
	tasks, err := loadUnlocked()
	if err != nil {
		return err
	}
	out := make([]TaskItem, 0, len(tasks))
	for _, t := range tasks {
		if t.ID != id {
			out = append(out, t)
		}
	}
	return saveUnlocked(out)
}
