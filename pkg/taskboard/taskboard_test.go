// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package taskboard

import "testing"

func TestTaskBoardCRUDAndBranchSlug(t *testing.T) {
	t.Setenv("SLTERM_CONFIG_HOME", t.TempDir())

	if got := SlugifyBranch("Fix Windows Auth & OAuth2 Redirect!"); got != "feat/fix-windows-auth-oauth2-redirect" {
		t.Fatalf("unexpected branch slug: %q", got)
	}

	created, err := SaveTask(TaskItem{
		Title:    "Add Rem Aqua Port Radar",
		Agent:    "claude",
		Priority: "high",
		RepoDir:  "/work/demo",
	})
	if err != nil {
		t.Fatalf("SaveTask failed: %v", err)
	}
	if created.ID == "" || created.Status != "todo" || created.Branch != "feat/add-rem-aqua-port-radar" {
		t.Fatalf("unexpected created task: %+v", created)
	}

	moved, err := MoveTask(created.ID, "in_progress", "/work/demo-wt-port-radar")
	if err != nil {
		t.Fatalf("MoveTask failed: %v", err)
	}
	if moved.Status != "in_progress" || moved.WorktreePath != "/work/demo-wt-port-radar" {
		t.Fatalf("unexpected moved task: %+v", moved)
	}

	all, err := ListTasks()
	if err != nil || len(all) != 1 || all[0].ID != created.ID {
		t.Fatalf("unexpected list: %+v err=%v", all, err)
	}

	if err := DeleteTask(created.ID); err != nil {
		t.Fatalf("DeleteTask failed: %v", err)
	}
	after, err := ListTasks()
	if err != nil || len(after) != 0 {
		t.Fatalf("expected empty board after delete, got %+v err=%v", after, err)
	}
}
