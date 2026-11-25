// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package adeworkspace manages saved project workspaces & 1-click multi-pane ADE
// layout presets (inspired by Orca, Superset & Herdr) persisted locally at
// ~/.slterm/config/ade-workspaces.json.
package adeworkspace

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// WorkspaceProfile saves a project directory with its preferred AI agent, layout preset, and dev URL.
type WorkspaceProfile struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	RepoDir      string `json:"repoDir"`
	DefaultAgent string `json:"defaultAgent"` // claude | codex | gemini | shell
	LayoutPreset string `json:"layoutPreset"` // full-ade | dual-agent | ship-review
	DevPort      int    `json:"devPort,omitempty"`
	Color        string `json:"color,omitempty"` // aqua | pink | mint
	LastOpenedMs int64  `json:"lastOpenedMs,omitempty"`
	UpdatedAtMs  int64  `json:"updatedAtMs"`
}

var mu sync.Mutex

func storePath() string {
	base := strings.TrimSpace(os.Getenv("SLTERM_CONFIG_HOME"))
	if base == "" {
		h, _ := os.UserHomeDir()
		base = filepath.Join(h, ".slterm", "config")
	}
	return filepath.Join(base, "ade-workspaces.json")
}

func randomID() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return "ws-" + hex.EncodeToString(b[:])
}

func normalizePreset(p string) string {
	switch strings.ToLower(strings.TrimSpace(p)) {
	case "dual-agent", "ship-review":
		return strings.ToLower(strings.TrimSpace(p))
	default:
		return "full-ade"
	}
}

func normalizeAgent(a string) string {
	switch strings.ToLower(strings.TrimSpace(a)) {
	case "codex", "gemini", "shell":
		return strings.ToLower(strings.TrimSpace(a))
	default:
		return "claude"
	}
}

func normalizeColor(c string) string {
	switch strings.ToLower(strings.TrimSpace(c)) {
	case "pink", "mint":
		return strings.ToLower(strings.TrimSpace(c))
	default:
		return "aqua"
	}
}

func loadUnlocked() ([]WorkspaceProfile, error) {
	raw, err := os.ReadFile(storePath())
	if err != nil {
		if os.IsNotExist(err) {
			return []WorkspaceProfile{}, nil
		}
		return nil, err
	}
	var list []WorkspaceProfile
	if err := json.Unmarshal(raw, &list); err != nil {
		return []WorkspaceProfile{}, nil
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].UpdatedAtMs > list[j].UpdatedAtMs
	})
	return list, nil
}

func saveUnlocked(list []WorkspaceProfile) error {
	p := storePath()
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// ListWorkspaces returns all saved project workspace profiles.
func ListWorkspaces() ([]WorkspaceProfile, error) {
	mu.Lock()
	defer mu.Unlock()
	return loadUnlocked()
}

// SaveWorkspace creates or updates a saved ADE workspace profile.
func SaveWorkspace(ws WorkspaceProfile) (*WorkspaceProfile, error) {
	ws.Name = strings.TrimSpace(ws.Name)
	ws.RepoDir = strings.TrimSpace(ws.RepoDir)
	if ws.Name == "" || ws.RepoDir == "" {
		return nil, errors.New("workspace name and repoDir are required")
	}
	if strings.ContainsRune(ws.RepoDir, '\x00') {
		return nil, errors.New("invalid NUL byte in repoDir")
	}
	ws.DefaultAgent = normalizeAgent(ws.DefaultAgent)
	ws.LayoutPreset = normalizePreset(ws.LayoutPreset)
	ws.Color = normalizeColor(ws.Color)
	if ws.DevPort < 0 || ws.DevPort > 65535 {
		ws.DevPort = 0
	}
	now := time.Now().UnixMilli()

	mu.Lock()
	defer mu.Unlock()
	list, err := loadUnlocked()
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(ws.ID) == "" {
		ws.ID = randomID()
		ws.UpdatedAtMs = now
		list = append([]WorkspaceProfile{ws}, list...)
	} else {
		found := false
		for i := range list {
			if list[i].ID == ws.ID {
				ws.UpdatedAtMs = now
				list[i] = ws
				found = true
				break
			}
		}
		if !found {
			ws.UpdatedAtMs = now
			list = append([]WorkspaceProfile{ws}, list...)
		}
	}
	if err := saveUnlocked(list); err != nil {
		return nil, err
	}
	cp := ws
	return &cp, nil
}

// DeleteWorkspace deletes a workspace profile by ID.
func DeleteWorkspace(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("workspace id is required")
	}
	mu.Lock()
	defer mu.Unlock()
	list, err := loadUnlocked()
	if err != nil {
		return err
	}
	out := make([]WorkspaceProfile, 0, len(list))
	for _, item := range list {
		if item.ID != id {
			out = append(out, item)
		}
	}
	return saveUnlocked(out)
}
