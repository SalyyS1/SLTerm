// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package agentsessions

import (
	"os"
	"path/filepath"
	"testing"
)

func TestEncodeCwdAndPlanRestoreDedup(t *testing.T) {
	if got := EncodeCwd(`C:\Users\Saly\My App`); got != "C--Users-Saly-My-App" {
		t.Fatalf("unexpected encoded Windows cwd: %q", got)
	}
	plans := PlanRestoreModes([]RestoreBlockRequest{
		{BlockID: "b1", Cwd: `C:\work\app`, SessionID: "sess-1"},
		{BlockID: "b2", Cwd: `C:\work\app`, SessionID: "sess-1"}, // duplicate session must NOT hijack!
		{BlockID: "b3", Cwd: `C:\work\app`},                      // same cwd -> fresh!
	})
	if plans[0].Mode != "resume" || len(plans[0].Args) != 1 || plans[0].Args[0] != "--resume=sess-1" {
		t.Fatalf("unexpected plan[0]: %+v", plans[0])
	}
	if plans[1].Mode != "continue" {
		t.Fatalf("expected duplicate session to fall back to continue, got %+v", plans[1])
	}
	if plans[2].Mode != "fresh" {
		t.Fatalf("expected third block in same cwd to start fresh, got %+v", plans[2])
	}
}

func TestListSessionsAndPromptNotesCRUD(t *testing.T) {
	tmpHome := t.TempDir()
	t.Setenv("SLTERM_AGENT_HOME", tmpHome)
	t.Setenv("SLTERM_CONFIG_HOME", filepath.Join(tmpHome, "cfg"))

	// Seed a synthetic Claude Code session and a Codex session
	claudeProj := filepath.Join(tmpHome, ".claude", "projects", "C--work-slterm")
	if err := os.MkdirAll(claudeProj, 0755); err != nil {
		t.Fatal(err)
	}
	claudeLine := `{"type":"user","cwd":"C:\\work\\slterm","message":{"content":"Upgrade SLTerm into a Windows-first ADE"}}` + "\n"
	if err := os.WriteFile(filepath.Join(claudeProj, "abc12345.jsonl"), []byte(claudeLine), 0644); err != nil {
		t.Fatal(err)
	}

	codexDir := filepath.Join(tmpHome, ".codex", "sessions", "2026", "11")
	if err := os.MkdirAll(codexDir, 0755); err != nil {
		t.Fatal(err)
	}
	codexLine := `{"type":"user","cwd":"/work/slclean","text":"Scan AI test junk safely"}` + "\n"
	if err := os.WriteFile(filepath.Join(codexDir, "codex999.jsonl"), []byte(codexLine), 0644); err != nil {
		t.Fatal(err)
	}

	idx, err := ListSessions("", "all", 20)
	if err != nil {
		t.Fatalf("ListSessions failed: %v", err)
	}
	if len(idx.Sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d: %+v", len(idx.Sessions), idx.Sessions)
	}

	filtered, err := ListSessions("slclean", "codex", 10)
	if err != nil || len(filtered.Sessions) != 1 || filtered.Sessions[0].ID != "codex999" {
		t.Fatalf("expected fuzzy match on codex999, got %+v err=%v", filtered, err)
	}

	// Verify agent detection returns our full Windows-first catalog
	agents := DetectInstalledAgents()
	if len(agents) < 8 {
		t.Fatalf("expected >=8 agent specs, got %d", len(agents))
	}

	// Verify Prompt Notes CRUD
	notes, err := ListNotes()
	if err != nil || len(notes) < 3 {
		t.Fatalf("expected starter notes, got %+v err=%v", notes, err)
	}
	saved, err := SaveNote(PromptNote{Title: "Deploy Check", Agent: "claude", Body: "Check build & CI"})
	if err != nil || saved.ID == "" {
		t.Fatalf("SaveNote failed: %v", err)
	}
	if err := DeleteNote(saved.ID); err != nil {
		t.Fatalf("DeleteNote failed: %v", err)
	}
}
