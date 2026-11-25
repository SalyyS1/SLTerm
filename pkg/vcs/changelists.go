// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package vcs

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// DefaultChangelist is the implicit group for unassigned files; never persisted as an entry.
const DefaultChangelist = "Default"

var changelistMu sync.Mutex

// changelistStore maps normalized repoRoot -> (relativeFilePath -> changelistName).
type changelistStore struct {
	Repos map[string]map[string]string `json:"repos"`
}

func changelistStorePath() string {
	if custom := strings.TrimSpace(os.Getenv("SLTERM_CONFIG_HOME")); custom != "" {
		return filepath.Join(custom, "changelists.json")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return filepath.Join(".", ".slterm", "config", "changelists.json")
	}
	return filepath.Join(home, ".slterm", "config", "changelists.json")
}

func normalizeRepoKey(repoRoot string) string {
	return strings.ToLower(filepath.ToSlash(filepath.Clean(repoRoot)))
}

func readStoreLocked() changelistStore {
	p := changelistStorePath()
	raw, err := os.ReadFile(p)
	if err != nil {
		return changelistStore{Repos: map[string]map[string]string{}}
	}
	var st changelistStore
	if err := json.Unmarshal(raw, &st); err != nil || st.Repos == nil {
		return changelistStore{Repos: map[string]map[string]string{}}
	}
	return st
}

func writeStoreLocked(st changelistStore) error {
	p := changelistStorePath()
	if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p, raw, 0600)
}

func loadRepoChangelists(repoRoot string) (map[string]string, []string) {
	changelistMu.Lock()
	defer changelistMu.Unlock()
	st := readStoreLocked()
	repoMap := st.Repos[normalizeRepoKey(repoRoot)]
	outMap := make(map[string]string, len(repoMap))
	nameSet := map[string]struct{}{DefaultChangelist: {}}
	for k, v := range repoMap {
		outMap[k] = v
		if v != "" {
			nameSet[v] = struct{}{}
		}
	}
	names := make([]string, 0, len(nameSet))
	for n := range nameSet {
		names = append(names, n)
	}
	sort.Slice(names, func(i, j int) bool {
		if names[i] == DefaultChangelist {
			return true
		}
		if names[j] == DefaultChangelist {
			return false
		}
		return names[i] < names[j]
	})
	return outMap, names
}

// AssignChangelist assigns a repo-relative file to a named changelist (or resets to Default).
func AssignChangelist(repoRoot, relPath, changelistName string) error {
	cleanPath, err := ValidateRelativePath(relPath)
	if err != nil {
		return err
	}
	name := strings.TrimSpace(changelistName)
	if name == "" {
		return errors.New("changelist name must not be empty")
	}
	changelistMu.Lock()
	defer changelistMu.Unlock()
	st := readStoreLocked()
	key := normalizeRepoKey(repoRoot)
	if st.Repos[key] == nil {
		st.Repos[key] = map[string]string{}
	}
	if strings.EqualFold(name, DefaultChangelist) {
		delete(st.Repos[key], cleanPath)
	} else {
		st.Repos[key][cleanPath] = name
	}
	return writeStoreLocked(st)
}
