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

	// Stage, diff, auto-draft commit message, and commit.
	if err := StageFiles(ctx, repo, []string{"sub/app.go"}); err != nil {
		t.Fatalf("StageFiles failed: %v", err)
	}
	draft, err := DraftCommitMessage(ctx, repo)
	if err != nil || !strings.HasPrefix(draft, "feat(sub): add app.go") {
		t.Fatalf("unexpected commit draft: %q err=%v", draft, err)
	}
	diff, err := GetDiff(ctx, repo, "sub/app.go", true)
	if err != nil || !strings.Contains(diff, "package sub") {
		t.Fatalf("expected staged diff containing 'package sub', got %q err=%v", diff, err)
	}
	if _, err := Commit(ctx, repo, "feat: add sub package"); err != nil {
		t.Fatalf("Commit failed: %v", err)
	}
	logEntries, err := GetLog(ctx, repo, 10)
	if err != nil || len(logEntries) < 2 || logEntries[0].Subject != "feat: add sub package" {
		t.Fatalf("unexpected GetLog result: %+v err=%v", logEntries, err)
	}
	showOut, err := ShowCommit(ctx, repo, logEntries[0].ShortHash)
	if err != nil || !strings.Contains(showOut, "sub/app.go") {
		t.Fatalf("unexpected ShowCommit output: %q err=%v", showOut, err)
	}
	if _, err := ShowCommit(ctx, repo, "--exec=evil"); err == nil {
		t.Fatal("expected invalid commit hash to be rejected")
	}

	// Add untracked local .env, CLAUDE.md, and .worktreeinclude (including a malicious traversal line that must be ignored).
	if err := os.WriteFile(filepath.Join(repo, ".env"), []byte("API_MODE=local\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "CLAUDE.md"), []byte("# Claude Rules\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "config.local.json"), []byte("{\"port\":3000}\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, ".worktreeinclude"), []byte("# copy local config\nconfig.local.json\n../../etc/passwd\n"), 0644); err != nil {
		t.Fatal(err)
	}

	// Create and list an isolated agent worktree, verify auto-hydration, dirty count, merge-back, and clean removal.
	wtDest := filepath.Join(t.TempDir(), "wt-claude")
	wt, err := CreateWorktree(ctx, repo, "agent/claude-task", wtDest)
	if err != nil {
		t.Fatalf("CreateWorktree failed: %v", err)
	}
	if wt.Branch != "agent/claude-task" {
		t.Fatalf("unexpected worktree: %+v", wt)
	}
	if len(wt.HydratedFiles) < 3 {
		t.Fatalf("expected .env, CLAUDE.md, and config.local.json to be hydrated, got %+v", wt.HydratedFiles)
	}
	if _, err := os.Stat(filepath.Join(wt.Path, ".env")); err != nil {
		t.Fatalf("expected .env hydrated into worktree: %v", err)
	}
	if _, err := os.Stat(filepath.Join(wt.Path, "config.local.json")); err != nil {
		t.Fatalf("expected .worktreeinclude file hydrated into worktree: %v", err)
	}
	wtStatus, err := GetStatus(ctx, wt.Path)
	if err != nil || !wtStatus.IsWorktree {
		t.Fatalf("expected linked worktree detection, got %+v err=%v", wtStatus, err)
	}
	wts, err := ListWorktrees(ctx, repo)
	if err != nil || len(wts) != 2 {
		t.Fatalf("expected 2 worktrees, got %+v err=%v", wts, err)
	}
	if wts[1].DirtyCount == 0 {
		t.Fatalf("expected hydrated untracked files to report DirtyCount > 0, got %+v", wts[1])
	}

	// Make a committed change in the worktree, clean untracked files on main, then MergeWorktree back to main.
	if err := os.WriteFile(filepath.Join(wt.Path, "feature.txt"), []byte("hello from agent\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := StageFiles(ctx, wt.Path, []string{"feature.txt"}); err != nil {
		t.Fatalf("StageFiles in worktree failed: %v", err)
	}
	if _, err := Commit(ctx, wt.Path, "feat: agent feature"); err != nil {
		t.Fatalf("Commit in worktree failed: %v", err)
	}
	// Clean untracked test files in main repo so MergeWorktree sees a clean main checkout.
	for _, f := range []string{".env", "CLAUDE.md", "config.local.json", ".worktreeinclude"} {
		_ = os.Remove(filepath.Join(repo, f))
	}
	if _, err := MergeWorktree(ctx, repo, "agent/claude-task", wt.Path, false); err != nil {
		t.Fatalf("MergeWorktree failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(repo, "feature.txt")); err != nil {
		t.Fatalf("expected merged feature.txt in main repo: %v", err)
	}

	if err := RemoveWorktree(ctx, repo, repo, false); err == nil {
		t.Fatal("expected removing main worktree to be refused")
	}
	if err := RemoveWorktree(ctx, repo, wt.Path, true); err != nil {
		t.Fatalf("RemoveWorktree failed: %v", err)
	}
}

func TestBranchesStashAndPruneWorktrees(t *testing.T) {
	t.Setenv("SLTERM_CONFIG_HOME", t.TempDir())
	repo := initTestRepo(t)
	ctx := context.Background()

	// Create and switch branch, rejecting flag injection.
	if _, err := CheckoutBranch(ctx, repo, "--orphan", true); err == nil {
		t.Fatal("expected flag injection branch checkout to fail")
	}
	if _, err := CheckoutBranch(ctx, repo, "feat/rem-aqua-ui", true); err != nil {
		t.Fatalf("CheckoutBranch create failed: %v", err)
	}
	branches, err := ListBranches(ctx, repo)
	if err != nil || len(branches) < 2 {
		t.Fatalf("expected >=2 branches, got %+v err=%v", branches, err)
	}
	foundCurrent := false
	for _, b := range branches {
		if b.Name == "feat/rem-aqua-ui" && b.Current {
			foundCurrent = true
		}
	}
	if !foundCurrent {
		t.Fatalf("expected feat/rem-aqua-ui to be current branch, got %+v", branches)
	}

	// Stash push, list, pop + invalid ref guard.
	if err := os.WriteFile(filepath.Join(repo, "wip.txt"), []byte("wip change\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := StashPush(ctx, repo, "save wip", true); err != nil {
		t.Fatalf("StashPush failed: %v", err)
	}
	stashes, err := ListStashes(ctx, repo)
	if err != nil || len(stashes) != 1 || !strings.Contains(stashes[0].Message, "save wip") {
		t.Fatalf("unexpected stashes: %+v err=%v", stashes, err)
	}
	if _, err := StashPop(ctx, repo, "--evil"); err == nil {
		t.Fatal("expected invalid stash ref to be rejected")
	}
	if _, err := StashPop(ctx, repo, stashes[0].Ref); err != nil {
		t.Fatalf("StashPop failed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(repo, "wip.txt")); err != nil {
		t.Fatalf("expected wip.txt restored after stash pop: %v", err)
	}

	// PruneWorktrees should succeed cleanly.
	if _, err := PruneWorktrees(ctx, repo); err != nil {
		t.Fatalf("PruneWorktrees failed: %v", err)
	}
}
