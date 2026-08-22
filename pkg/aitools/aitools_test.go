// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package aitools

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// writeFile creates parents and writes content, failing the test on error.
func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// fakeHome points os.UserHomeDir at a temp dir. On unix that reads $HOME, which
// is how these tests exercise the real path-resolution code rather than a seam
// added only for testing.
func fakeHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	return home
}

func TestReadInventoryFindsSkillsAgentsAndCommands(t *testing.T) {
	home := fakeHome(t)
	claude := filepath.Join(home, ".claude")

	// A skill is a DIRECTORY containing SKILL.md, not a flat file. A scan that
	// only looks at files finds none of these.
	writeFile(t, filepath.Join(claude, "skills", "deploy", "SKILL.md"),
		"---\nname: deploy\ndescription: Ship the thing\n---\n\nbody\n")
	writeFile(t, filepath.Join(claude, "skills", "review", "SKILL.md"), "no front matter here")
	// A directory without SKILL.md is not a skill and must not appear.
	if err := os.MkdirAll(filepath.Join(claude, "skills", "not-a-skill"), 0o700); err != nil {
		t.Fatal(err)
	}
	writeFile(t, filepath.Join(claude, "agents", "planner.md"), "---\ndescription: Plans\n---\n")
	writeFile(t, filepath.Join(claude, "commands", "ship.md"), "run it")
	// Non-markdown files in a flat category are ignored.
	writeFile(t, filepath.Join(claude, "commands", "notes.txt"), "ignore me")

	inv, err := ReadInventory("")
	if err != nil {
		t.Fatalf("ReadInventory: %v", err)
	}

	if len(inv.Skills) != 2 {
		t.Errorf("skills: got %d, want 2 (%+v)", len(inv.Skills), inv.Skills)
	}
	if len(inv.Agents) != 1 {
		t.Errorf("agents: got %d, want 1", len(inv.Agents))
	}
	if len(inv.Commands) != 1 {
		t.Errorf("commands: got %d, want 1 (.txt must be ignored)", len(inv.Commands))
	}
	if len(inv.Warnings) != 0 {
		t.Errorf("warnings: got %v, want none for a well-formed tree", inv.Warnings)
	}

	// Sorted by name, so "deploy" precedes "review".
	if inv.Skills[0].Name != "deploy" {
		t.Errorf("skills not sorted by name: %s first", inv.Skills[0].Name)
	}
	if inv.Skills[0].Description != "Ship the thing" {
		t.Errorf("front matter description: got %q", inv.Skills[0].Description)
	}
	if inv.Skills[1].Description != "" {
		t.Errorf("missing front matter should yield an empty description, got %q", inv.Skills[1].Description)
	}
	if inv.Skills[0].Scope != ScopeUser {
		t.Errorf("scope: got %q, want user", inv.Skills[0].Scope)
	}
	if inv.Skills[0].SizeBytes == 0 || inv.Skills[0].ModTimeMs == 0 {
		t.Errorf("size/modtime not populated: %+v", inv.Skills[0])
	}
}

func TestReadInventoryEmptyHomeIsQuiet(t *testing.T) {
	fakeHome(t)
	inv, err := ReadInventory("")
	if err != nil {
		t.Fatalf("ReadInventory on an empty home: %v", err)
	}
	// Nothing configured is the normal state for a new user and must not look
	// like a failure — that distinction is the whole point of Warnings.
	if len(inv.Warnings) != 0 {
		t.Errorf("absent directories must not warn, got %v", inv.Warnings)
	}
	if len(inv.Skills)+len(inv.Agents)+len(inv.Commands)+len(inv.MCP) != 0 {
		t.Errorf("expected an empty inventory, got %+v", inv)
	}
}

func TestReadInventoryProjectScopeIsSeparate(t *testing.T) {
	home := fakeHome(t)
	writeFile(t, filepath.Join(home, ".claude", "skills", "shared", "SKILL.md"), "user copy")

	project := t.TempDir()
	writeFile(t, filepath.Join(project, ".claude", "skills", "shared", "SKILL.md"), "project copy")

	inv, err := ReadInventory(project)
	if err != nil {
		t.Fatalf("ReadInventory: %v", err)
	}
	// Same name in both scopes must yield two entries: which file defines a
	// thing is exactly what the user needs to see when scopes disagree.
	if len(inv.Skills) != 2 {
		t.Fatalf("want both scopes listed, got %d: %+v", len(inv.Skills), inv.Skills)
	}
	scopes := map[Scope]bool{}
	for _, s := range inv.Skills {
		scopes[s.Scope] = true
	}
	if !scopes[ScopeUser] || !scopes[ScopeProject] {
		t.Errorf("want one user and one project entry, got %+v", inv.Skills)
	}
}

func TestReadMCPServersDerivesTransport(t *testing.T) {
	home := fakeHome(t)
	cfg := map[string]any{
		"mcpServers": map[string]any{
			"local":  map[string]any{"command": "node", "args": []string{"srv.js"}},
			"remote": map[string]any{"url": "https://example.test/mcp"},
			"tagged": map[string]any{"type": "sse", "url": "https://example.test/sse"},
			"empty":  map[string]any{},
		},
		"somethingElse": "ignored",
	}
	raw, _ := json.Marshal(cfg)
	writeFile(t, filepath.Join(home, ".claude.json"), string(raw))

	inv, err := ReadInventory("")
	if err != nil {
		t.Fatalf("ReadInventory: %v", err)
	}
	got := map[string]string{}
	for _, s := range inv.MCP {
		got[s.Name] = s.Transport
	}
	want := map[string]string{"local": "stdio", "remote": "http", "tagged": "sse", "empty": "unknown"}
	for name, transport := range want {
		if got[name] != transport {
			t.Errorf("%s transport: got %q, want %q", name, got[name], transport)
		}
	}
}

func TestMalformedMCPFileWarnsRatherThanFailing(t *testing.T) {
	home := fakeHome(t)
	writeFile(t, filepath.Join(home, ".claude.json"), "{ this is not json")

	inv, err := ReadInventory("")
	if err != nil {
		t.Fatalf("a malformed config must not fail the whole read: %v", err)
	}
	// A drifted/broken format has to be visible. Silently returning an empty
	// list is indistinguishable from "nothing configured".
	if len(inv.Warnings) == 0 {
		t.Error("want a warning for unparseable ~/.claude.json, got none")
	}
}

func TestItemNamesMustBeSinglePathSegments(t *testing.T) {
	fakeHome(t)
	for _, name := range []string{"", ".", "..", "../escape", "a/b", `a\b`, "with\x00null"} {
		if _, err := ReadItem(KindSkill, ScopeUser, name, ""); err == nil {
			t.Errorf("ReadItem(%q) should have been rejected", name)
		}
		if err := WriteItem(KindSkill, ScopeUser, name, "", "x"); err == nil {
			t.Errorf("WriteItem(%q) should have been rejected", name)
		}
		if err := DeleteItem(KindSkill, ScopeUser, name, ""); err == nil {
			t.Errorf("DeleteItem(%q) should have been rejected", name)
		}
	}
}

func TestWriteReadDeleteRoundTrip(t *testing.T) {
	home := fakeHome(t)

	if err := WriteItem(KindAgent, ScopeUser, "fresh", "", "hello"); err != nil {
		t.Fatalf("WriteItem: %v", err)
	}
	body, err := ReadItem(KindAgent, ScopeUser, "fresh", "")
	if err != nil || body != "hello" {
		t.Fatalf("ReadItem: got %q, %v", body, err)
	}

	// Files hold the user's own prompts; they should not be world-readable.
	info, err := os.Stat(filepath.Join(home, ".claude", "agents", "fresh.md"))
	if err != nil {
		t.Fatal(err)
	}
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Errorf("agent file mode: got %o, want 600", perm)
	}

	if err := DeleteItem(KindAgent, ScopeUser, "fresh", ""); err != nil {
		t.Fatalf("DeleteItem: %v", err)
	}
	if _, err := ReadItem(KindAgent, ScopeUser, "fresh", ""); err == nil {
		t.Error("reading a deleted agent should fail")
	}
}

func TestDeletingASkillRemovesItsDirectory(t *testing.T) {
	home := fakeHome(t)
	skillDir := filepath.Join(home, ".claude", "skills", "doomed")
	writeFile(t, filepath.Join(skillDir, "SKILL.md"), "body")
	writeFile(t, filepath.Join(skillDir, "reference.md"), "bundled resource")

	if err := DeleteItem(KindSkill, ScopeUser, "doomed", ""); err != nil {
		t.Fatalf("DeleteItem: %v", err)
	}
	// A skill is a directory. Removing only SKILL.md would leave an empty
	// directory behind, which then shows up as a broken half-skill.
	if _, err := os.Stat(skillDir); !os.IsNotExist(err) {
		t.Errorf("skill directory should be gone, stat err = %v", err)
	}
}

func TestProjectScopeRequiresAProjectDir(t *testing.T) {
	fakeHome(t)
	if _, err := ReadItem(KindSkill, ScopeProject, "thing", ""); err == nil {
		t.Error("project scope without a project dir should be rejected")
	}
	if _, err := ReadItem(KindSkill, "bogus", "thing", ""); err == nil {
		t.Error("an unknown scope should be rejected")
	}
	if _, err := ReadItem("bogus", ScopeUser, "thing", ""); err == nil {
		t.Error("an unknown kind should be rejected")
	}
}

func TestFrontMatterDescription(t *testing.T) {
	cases := []struct{ in, want string }{
		{"---\ndescription: plain\n---\n", "plain"},
		{`---` + "\n" + `description: "quoted"` + "\n---\n", "quoted"},
		{"---\ndescription: 'single'\n---\n", "single"},
		{"---\nname: x\n---\n", ""},
		{"no front matter", ""},
		{"", ""},
		// A description appearing after the closing marker is body text.
		{"---\nname: x\n---\ndescription: too late\n", ""},
	}
	for _, c := range cases {
		if got := frontMatterDescription([]byte(c.in)); got != c.want {
			t.Errorf("frontMatterDescription(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
