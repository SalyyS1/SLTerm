// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package adeworkspace

import "testing"

func TestWorkspaceProfileCRUD(t *testing.T) {
	t.Setenv("SLTERM_CONFIG_HOME", t.TempDir())

	saved, err := SaveWorkspace(WorkspaceProfile{
		Name:         "SLTerm Rem Aqua",
		RepoDir:      `C:\work\SLTerm`,
		DefaultAgent: "claude",
		LayoutPreset: "dual-agent",
		DevPort:      5173,
		Color:        "aqua",
	})
	if err != nil {
		t.Fatalf("SaveWorkspace failed: %v", err)
	}
	if saved.ID == "" || saved.LayoutPreset != "dual-agent" || saved.DevPort != 5173 {
		t.Fatalf("unexpected saved workspace: %+v", saved)
	}

	list, err := ListWorkspaces()
	if err != nil || len(list) != 1 || list[0].Name != "SLTerm Rem Aqua" {
		t.Fatalf("unexpected workspace list: %+v err=%v", list, err)
	}

	if err := DeleteWorkspace(saved.ID); err != nil {
		t.Fatalf("DeleteWorkspace failed: %v", err)
	}
	after, err := ListWorkspaces()
	if err != nil || len(after) != 0 {
		t.Fatalf("expected empty list after delete, got %+v err=%v", after, err)
	}
}
