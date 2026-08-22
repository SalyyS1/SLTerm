// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package agentteams

import (
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

// fakeHome points os.UserHomeDir at a temp dir. On unix that reads $HOME, so
// these tests drive the real path resolution rather than a test-only seam.
func fakeHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	return home
}

func TestReadSnapshotReadsRosterAndTasks(t *testing.T) {
	home := fakeHome(t)
	claude := filepath.Join(home, ".claude")

	writeFile(t, filepath.Join(claude, "teams", "alpha", "config.json"), `{
        "name": "Alpha",
        "description": "the first team",
        "leadAgentId": "a1",
        "members": [
            {"agentId": "a1", "name": "lead", "agentType": "planner", "model": "opus"},
            {"agentId": "a2", "name": "hand", "agentType": "coder"}
        ]
    }`)
	writeFile(t, filepath.Join(claude, "tasks", "alpha", "1.json"),
		`{"id":"1","subject":"done thing","status":"completed"}`)
	writeFile(t, filepath.Join(claude, "tasks", "alpha", "2.json"),
		`{"id":"2","subject":"active thing","status":"in_progress","owner":"hand"}`)
	writeFile(t, filepath.Join(claude, "tasks", "alpha", "3.json"),
		`{"id":"3","subject":"waiting","status":"pending","blockedBy":["2"]}`)

	snap, err := ReadSnapshot()
	if err != nil {
		t.Fatalf("ReadSnapshot: %v", err)
	}
	if len(snap.Warnings) != 0 {
		t.Errorf("well-formed tree should not warn: %v", snap.Warnings)
	}
	if len(snap.Teams) != 1 {
		t.Fatalf("teams: got %d, want 1", len(snap.Teams))
	}
	team := snap.Teams[0]
	if team.DirName != "alpha" || team.Config.Name != "Alpha" {
		t.Errorf("dirname/name: got %q/%q", team.DirName, team.Config.Name)
	}
	if len(team.Config.Members) != 2 {
		t.Errorf("members: got %d, want 2", len(team.Config.Members))
	}
	if team.Config.Members[0].Model != "opus" {
		t.Errorf("member model not parsed: %+v", team.Config.Members[0])
	}

	// Sorted so in-progress rises and completed sinks — the order someone
	// scanning a board wants.
	if len(team.Tasks) != 3 {
		t.Fatalf("tasks: got %d, want 3", len(team.Tasks))
	}
	gotOrder := []string{team.Tasks[0].Status, team.Tasks[1].Status, team.Tasks[2].Status}
	want := []string{"in_progress", "pending", "completed"}
	for i := range want {
		if gotOrder[i] != want[i] {
			t.Errorf("task order: got %v, want %v", gotOrder, want)
			break
		}
	}
	if len(team.Tasks[1].BlockedBy) != 1 {
		t.Errorf("blockedBy not parsed: %+v", team.Tasks[1])
	}
}

func TestNoTeamsDirectoryIsQuiet(t *testing.T) {
	fakeHome(t)
	snap, err := ReadSnapshot()
	if err != nil {
		t.Fatalf("ReadSnapshot with no ~/.claude: %v", err)
	}
	// Never having run a team is the normal state and must not look like an
	// error; that is what separates "no teams" from "format drifted".
	if len(snap.Teams) != 0 || len(snap.Warnings) != 0 {
		t.Errorf("want an empty quiet snapshot, got %+v", snap)
	}
}

func TestMalformedConfigWarnsAndOtherTeamsStillLoad(t *testing.T) {
	home := fakeHome(t)
	teams := filepath.Join(home, ".claude", "teams")
	writeFile(t, filepath.Join(teams, "broken", "config.json"), "{not json")
	writeFile(t, filepath.Join(teams, "fine", "config.json"), `{"name":"Fine","members":[]}`)

	snap, err := ReadSnapshot()
	if err != nil {
		t.Fatalf("one bad team must not fail the read: %v", err)
	}
	if len(snap.Warnings) == 0 {
		t.Error("want a warning for the unparseable config")
	}
	if len(snap.Teams) != 1 || snap.Teams[0].DirName != "fine" {
		t.Errorf("the readable team should still load, got %+v", snap.Teams)
	}
}

func TestTeamDirWithoutConfigIsSkippedSilently(t *testing.T) {
	home := fakeHome(t)
	if err := os.MkdirAll(filepath.Join(home, ".claude", "teams", "empty"), 0o700); err != nil {
		t.Fatal(err)
	}
	snap, err := ReadSnapshot()
	if err != nil {
		t.Fatalf("ReadSnapshot: %v", err)
	}
	// A directory with no config.json is not a team; absence is not a warning.
	if len(snap.Teams) != 0 {
		t.Errorf("teams: got %d, want 0", len(snap.Teams))
	}
	if len(snap.Warnings) != 0 {
		t.Errorf("a missing config.json should not warn: %v", snap.Warnings)
	}
}

func TestConfigNameFallsBackToDirName(t *testing.T) {
	home := fakeHome(t)
	writeFile(t, filepath.Join(home, ".claude", "teams", "unnamed", "config.json"), `{"members":[]}`)
	snap, err := ReadSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Teams) != 1 || snap.Teams[0].Config.Name != "unnamed" {
		t.Errorf("want the name to fall back to the directory, got %+v", snap.Teams)
	}
}

func TestTeamNameMustBeASinglePathSegment(t *testing.T) {
	fakeHome(t)
	// team_name arrives from the UI and is joined into a filesystem path, so
	// without this it is an arbitrary-directory-read vector.
	for _, name := range []string{"", ".", "..", "../../etc", "a/b", `a\b`, "with\x00null"} {
		if _, err := ReadTasks(name); err == nil {
			t.Errorf("ReadTasks(%q) should have been rejected", name)
		}
	}
}

func TestReadTasksIgnoresNonJSONAndUnparseableFiles(t *testing.T) {
	home := fakeHome(t)
	dir := filepath.Join(home, ".claude", "tasks", "team")
	writeFile(t, filepath.Join(dir, "good.json"), `{"subject":"real","status":"pending"}`)
	writeFile(t, filepath.Join(dir, "notes.txt"), "not a task")
	writeFile(t, filepath.Join(dir, "bad.json"), "{broken")

	tasks, err := ReadTasks("team")
	if err != nil {
		t.Fatalf("ReadTasks: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("tasks: got %d, want 1 (.txt and broken json ignored): %+v", len(tasks), tasks)
	}
	// The id falls back to the filename when the JSON omits it, so the UI always
	// has a stable key.
	if tasks[0].ID != "good" {
		t.Errorf("id should fall back to the filename, got %q", tasks[0].ID)
	}
}

func TestReadTasksForUnknownTeamIsEmptyNotAnError(t *testing.T) {
	fakeHome(t)
	tasks, err := ReadTasks("never-existed")
	if err != nil {
		t.Errorf("a team with no task dir should be empty, not an error: %v", err)
	}
	if len(tasks) != 0 {
		t.Errorf("tasks: got %d, want 0", len(tasks))
	}
}
