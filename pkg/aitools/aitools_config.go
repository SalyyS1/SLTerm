// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package aitools

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// mcpFile is the shape we care about inside ~/.claude.json and .mcp.json. Both
// wrap their servers in an `mcpServers` object; everything else in those files
// is ignored.
type mcpFile struct {
	MCPServers map[string]mcpEntry `json:"mcpServers"`
}

// mcpEntry covers both transports. Which fields are set determines the
// transport, so all of them are optional.
type mcpEntry struct {
	Command string            `json:"command,omitempty"`
	Args    []string          `json:"args,omitempty"`
	URL     string            `json:"url,omitempty"`
	Env     map[string]string `json:"env,omitempty"`
	Type    string            `json:"type,omitempty"`
}

func (e mcpEntry) transport() string {
	if e.Type != "" {
		return e.Type
	}
	if e.URL != "" {
		return "http"
	}
	if e.Command != "" {
		return "stdio"
	}
	return "unknown"
}

// readMCPFile parses one file's mcpServers map. A missing file is normal and
// silent; a file that exists but cannot be read or parsed is a warning, because
// that is the case where the user has configuration that we are failing to show.
func readMCPFile(path string, scope Scope, warn func(string)) []MCPServer {
	raw, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			warn(fmt.Sprintf("cannot read %s: %v", path, err))
		}
		return nil
	}
	var parsed mcpFile
	if err := json.Unmarshal(raw, &parsed); err != nil {
		warn(fmt.Sprintf("cannot parse %s: %v", path, err))
		return nil
	}
	servers := make([]MCPServer, 0, len(parsed.MCPServers))
	for name, entry := range parsed.MCPServers {
		servers = append(servers, MCPServer{
			Name:       name,
			Transport:  entry.transport(),
			Command:    entry.Command,
			Args:       entry.Args,
			URL:        entry.URL,
			Env:        entry.Env,
			Scope:      scope,
			SourcePath: path,
		})
	}
	sort.Slice(servers, func(i, j int) bool { return servers[i].Name < servers[j].Name })
	return servers
}

// ReadInventory collects every skill, agent, command and MCP server visible
// from projectDir. Pass an empty projectDir to read user scope only.
//
// User and project scope are kept as separate entries rather than merged: which
// file defines a server is exactly what a user needs to know when two scopes
// disagree, and merging would hide that.
func ReadInventory(projectDir string) (*Inventory, error) {
	inv := &Inventory{}
	warn := func(msg string) { inv.Warnings = append(inv.Warnings, msg) }

	userDir, err := userClaudeDir()
	if err != nil {
		return nil, err
	}

	inv.Skills = readSkills(userDir, ScopeUser, warn)
	inv.Agents = readMarkdownItems(userDir, "agents", KindAgent, ScopeUser, warn)
	inv.Commands = readMarkdownItems(userDir, "commands", KindCommand, ScopeUser, warn)

	home, err := os.UserHomeDir()
	if err == nil {
		inv.MCP = append(inv.MCP, readMCPFile(filepath.Join(home, ".claude.json"), ScopeUser, warn)...)
	}

	if projectDir != "" {
		projectClaude := filepath.Join(projectDir, ".claude")
		inv.Skills = append(inv.Skills, readSkills(projectClaude, ScopeProject, warn)...)
		inv.Agents = append(inv.Agents, readMarkdownItems(projectClaude, "agents", KindAgent, ScopeProject, warn)...)
		inv.Commands = append(inv.Commands, readMarkdownItems(projectClaude, "commands", KindCommand, ScopeProject, warn)...)
		inv.MCP = append(inv.MCP, readMCPFile(filepath.Join(projectDir, ".mcp.json"), ScopeProject, warn)...)
	}

	return inv, nil
}

// resolveItemPath maps a (kind, scope, name) triple to a path on disk, applying
// the single-segment name check before any join.
func resolveItemPath(kind Kind, scope Scope, name string, projectDir string) (string, error) {
	if err := validateName(name); err != nil {
		return "", err
	}
	var root string
	switch scope {
	case ScopeUser:
		dir, err := userClaudeDir()
		if err != nil {
			return "", err
		}
		root = dir
	case ScopeProject:
		if projectDir == "" {
			return "", fmt.Errorf("project scope requires a project directory")
		}
		root = filepath.Join(projectDir, ".claude")
	default:
		return "", fmt.Errorf("unknown scope %q", scope)
	}

	switch kind {
	case KindSkill:
		return filepath.Join(root, "skills", name, "SKILL.md"), nil
	case KindAgent:
		return filepath.Join(root, "agents", name+".md"), nil
	case KindCommand:
		return filepath.Join(root, "commands", name+".md"), nil
	default:
		return "", fmt.Errorf("unknown kind %q", kind)
	}
}

// ReadItem returns the markdown body of one item.
func ReadItem(kind Kind, scope Scope, name string, projectDir string) (string, error) {
	path, err := resolveItemPath(kind, scope, name, projectDir)
	if err != nil {
		return "", err
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("cannot read %s %q: %w", kind, name, err)
	}
	return string(content), nil
}

// WriteItem creates or replaces one item, creating parent directories as
// needed. Files are 0600 and directories 0700: these hold prompts and agent
// instructions, which are the user's own content and not other users' business.
func WriteItem(kind Kind, scope Scope, name string, projectDir string, content string) error {
	path, err := resolveItemPath(kind, scope, name, projectDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("cannot create directory for %s %q: %w", kind, name, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return fmt.Errorf("cannot write %s %q: %w", kind, name, err)
	}
	return nil
}

// DeleteItem removes one item. For a skill this removes the whole skill
// directory, since a skill is a directory and leaving an empty one behind would
// keep it visible as a broken entry.
func DeleteItem(kind Kind, scope Scope, name string, projectDir string) error {
	path, err := resolveItemPath(kind, scope, name, projectDir)
	if err != nil {
		return err
	}
	if kind == KindSkill {
		// resolveItemPath returned .../skills/<name>/SKILL.md; remove the
		// directory that owns it. Recomputed from the validated path rather
		// than re-joining the name, so the containment check still applies.
		if err := os.RemoveAll(filepath.Dir(path)); err != nil {
			return fmt.Errorf("cannot delete skill %q: %w", name, err)
		}
		return nil
	}
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("cannot delete %s %q: %w", kind, name, err)
	}
	return nil
}
