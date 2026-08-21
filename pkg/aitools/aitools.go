// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

// Package aitools reads and writes the on-disk configuration that AI coding
// CLIs (Claude Code, Codex) keep in the user's home directory: skills, agents,
// slash commands and MCP server definitions.
//
// Everything here talks to an undocumented, private on-disk layout owned by
// those tools. Parsing is therefore deliberately lenient: a shape we do not
// recognize yields an empty result and a Warning the UI can surface, never a
// hard error and never a silent blank panel.
package aitools

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Scope distinguishes config that lives in the user's home directory from
// config committed inside a project.
type Scope string

const (
	ScopeUser    Scope = "user"
	ScopeProject Scope = "project"
)

// Kind is the category of AI config item.
type Kind string

const (
	KindSkill   Kind = "skill"
	KindAgent   Kind = "agent"
	KindCommand Kind = "command"
)

// Item is one skill, agent or slash command.
type Item struct {
	Kind Kind `json:"kind"`
	// Name is the addressable identifier: the directory name for a skill, the
	// filename without extension for an agent or command.
	Name        string `json:"name"`
	Scope       Scope  `json:"scope"`
	Path        string `json:"path"`
	Description string `json:"description,omitempty"`
	SizeBytes   int64  `json:"sizebytes"`
	ModTimeMs   int64  `json:"modtimems"`
}

// MCPServer is one entry from an `mcpServers` map.
type MCPServer struct {
	Name string `json:"name"`
	// Transport is "stdio" when the entry runs a command, "http" when it
	// points at a URL. Derived, not stored on disk.
	Transport string            `json:"transport"`
	Command   string            `json:"command,omitempty"`
	Args      []string          `json:"args,omitempty"`
	URL       string            `json:"url,omitempty"`
	Env       map[string]string `json:"env,omitempty"`
	Scope     Scope             `json:"scope"`
	// SourcePath is the file the entry was read from, so the UI can say where
	// a server is defined when user and project scope disagree.
	SourcePath string `json:"sourcepath"`
}

// Inventory is a full snapshot of the AI tool configuration.
type Inventory struct {
	Skills   []Item      `json:"skills"`
	Agents   []Item      `json:"agents"`
	Commands []Item      `json:"commands"`
	MCP      []MCPServer `json:"mcp"`
	// Warnings records anything that could not be read or parsed. A non-empty
	// Warnings with empty results is the signal that the on-disk format has
	// drifted, as opposed to the user simply having nothing configured.
	Warnings []string `json:"warnings,omitempty"`
}

// ErrInvalidName is returned for a name that is not a single safe path segment.
var ErrInvalidName = fmt.Errorf("name must be a single path segment without separators")

// validateName rejects anything that could escape the directory it addresses.
// Skills are directories and agents/commands are files, but both are addressed
// by a single segment, so one check covers all three.
func validateName(name string) error {
	if name == "" || name == "." || name == ".." {
		return ErrInvalidName
	}
	if strings.ContainsAny(name, `/\`) || strings.ContainsRune(name, 0) {
		return ErrInvalidName
	}
	if filepath.Base(name) != name {
		return ErrInvalidName
	}
	return nil
}

func userClaudeDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot resolve home directory: %w", err)
	}
	return filepath.Join(home, ".claude"), nil
}

// frontMatterDescription pulls `description:` out of a leading YAML front
// matter block. It is a targeted scan rather than a YAML parse: we only ever
// want this one field, and a malformed block should cost us the description,
// not the whole listing.
func frontMatterDescription(content []byte) string {
	text := string(content)
	if !strings.HasPrefix(text, "---") {
		return ""
	}
	lines := strings.Split(text, "\n")
	for _, line := range lines[1:] {
		trimmed := strings.TrimSpace(line)
		if trimmed == "---" {
			break
		}
		if after, ok := strings.CutPrefix(trimmed, "description:"); ok {
			return strings.Trim(strings.TrimSpace(after), `"'`)
		}
	}
	return ""
}

// readSkills enumerates skills, which use a directory-per-item layout with the
// body in <name>/SKILL.md. A flat file-per-item scan does not find these.
func readSkills(root string, scope Scope, warn func(string)) []Item {
	dir := filepath.Join(root, "skills")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !os.IsNotExist(err) {
			warn(fmt.Sprintf("cannot read %s: %v", dir, err))
		}
		return nil
	}
	var items []Item
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		skillPath := filepath.Join(dir, entry.Name(), "SKILL.md")
		info, err := os.Stat(skillPath)
		if err != nil {
			// A directory without SKILL.md is not a skill; only report it if
			// something other than absence went wrong.
			if !os.IsNotExist(err) {
				warn(fmt.Sprintf("cannot stat %s: %v", skillPath, err))
			}
			continue
		}
		item := Item{
			Kind:      KindSkill,
			Name:      entry.Name(),
			Scope:     scope,
			Path:      skillPath,
			SizeBytes: info.Size(),
			ModTimeMs: info.ModTime().UnixMilli(),
		}
		if content, err := os.ReadFile(skillPath); err == nil {
			item.Description = frontMatterDescription(content)
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items
}

// readMarkdownItems enumerates the flat file-per-item categories.
func readMarkdownItems(root string, subdir string, kind Kind, scope Scope, warn func(string)) []Item {
	dir := filepath.Join(root, subdir)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if !os.IsNotExist(err) {
			warn(fmt.Sprintf("cannot read %s: %v", dir, err))
		}
		return nil
	}
	var items []Item
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		fullPath := filepath.Join(dir, entry.Name())
		info, err := entry.Info()
		if err != nil {
			warn(fmt.Sprintf("cannot stat %s: %v", fullPath, err))
			continue
		}
		item := Item{
			Kind:      kind,
			Name:      strings.TrimSuffix(entry.Name(), ".md"),
			Scope:     scope,
			Path:      fullPath,
			SizeBytes: info.Size(),
			ModTimeMs: info.ModTime().UnixMilli(),
		}
		if content, err := os.ReadFile(fullPath); err == nil {
			item.Description = frontMatterDescription(content)
		}
		items = append(items, item)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items
}
