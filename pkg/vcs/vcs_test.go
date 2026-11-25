// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package vcs

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func initTestRepo(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v failed: %v\n%s", args, err, string(out))
		}
	}
	run("init", "-q")
	run("config", "user.email", "ade@slterm.dev")
	run("config", "user.name", "SLTerm ADE")
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("# demo\n"), 0644); err != nil {
		t.Fatal(err)
	}
	run("add", "README.md")
	run("commit", "-m", "initial commit")
	return dir
}

func TestValidatePathAndBranchGuards(t *testing.T) {
	if _, err := ValidateRelativePath("../../etc/passwd"); err == nil {
		t.Fatal("expected traversal path to be rejected")
	}
	if _, err := ValidateRelativePath("-rf"); err == nil {
		t.Fatal("expected leading-dash flag path to be rejected")
	}
	if _, err := ValidateBranchName(";rm -rf /"); err == nil {
		t.Fatal("expected shell metacharacters in branch name to be rejected")
	}
	if _, err := ValidateBranchName("--orphan"); err == nil {
		t.Fatal("expected leading-dash branch name to be rejected")
	}
	got, err := ValidateBranchName("feat/agent-worktree-1")
	if err != nil || got != "feat/agent-worktree-1" {
		t.Fatalf("expected valid branch, got %q err=%v", got, err)
	}
}

func TestStatusStageDiffCommitWorktreeAndChangelist(t *testing.T) {
	t.Setenv("SLTERM_CONFIG_HOME", t.TempDir())
	repo := initTestRepo(t)
	ctx := context.Background()

	sub := filepath.Join(repo, "sub")
	if err := os.MkdirAll(sub, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sub, "app.go"), []byte("package sub\n"), 0644); err != nil {
		t.Fatal(err)
	}

	// Status from a subdirectory must resolve relative to repo root.
	st, err := GetStatus(ctx, sub)
	if err != nil {
		t.Fatalf("GetStatus failed: %v", err)
	}
	if filepath.Clean(st.RepoRoot) != filepath.Clean(repo) {
		t.Fatalf("expected repo root %s, got %s", repo, st.RepoRoot)
	}
	if len(st.Changes) != 1 || st.Changes[0].Path != "sub/app.go" || !st.Changes[0].Untracked {
		t.Fatalf("unexpected changes: %+v", st.Changes)
	}

	// Assign to a named changelist and verify persistence.
	if err := AssignChangelist(repo, "sub/app.go", "AI-Refactor"); err != nil {
		t.Fatalf("AssignChangelist failed: %v", err)
	}
	st2, err := GetStatus(ctx, repo)
	if err != nil {
		t.Fatal(err)
	}
	if st2.Changes[0].Changelist != "AI-Refactor" {
		t.Fatalf("expected AI-Refactor changelist, got %q", st2.Changes[0].Changelist)
	}

	// Stage, diff, and commit.
	if err := StageFiles(ctx, repo, []string{"sub/app.go"}); err != nil {
		t.Fatalf("StageFiles failed: %v", err)
	}
	diff, err := GetDiff(ctx, repo, "sub/app.go", true)
	if err != nil || !strings.Contains(diff, "package sub") {
		t.Fatalf("expected staged diff containing 'package sub', got %q err=%v", diff, err)
	}
	if _, err := Commit(ctx, repo, "feat: add sub package"); err != nil {
		t.Fatalf("Commit failed: %v", err)
	}

	// Create and list an isolated agent worktree, then remove it cleanly.
	wtDest := filepath.Join(t.TempDir(), "wt-claude")
	wt, err := CreateWorktree(ctx, repo, "agent/claude-task", wtDest)
	if err != nil {
		t.Fatalf("CreateWorktree failed: %v", err)
	}
	if wt.Branch != "agent/claude-task" {
		t.Fatalf("unexpected worktree: %+v", wt)
	}
	wtStatus, err := GetStatus(ctx, wt.Path)
	if err != nil || !wtStatus.IsWorktree {
		t.Fatalf("expected linked worktree detection, got %+v err=%v", wtStatus, err)
	}
	wts, err := ListWorktrees(ctx, repo)
	if err != nil || len(wts) != 2 {
		t.Fatalf("expected 2 worktrees, got %+v err=%v", wts, err)
	}
	if err := RemoveWorktree(ctx, repo, repo, false); err == nil {
		t.Fatal("expected removing main worktree to be refused")
	}
	if err := RemoveWorktree(ctx, repo, wt.Path, true); err != nil {
		t.Fatalf("RemoveWorktree failed: %v", err)
	}
}
