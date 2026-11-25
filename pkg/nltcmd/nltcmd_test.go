// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package nltcmd

import (
	"strings"
	"testing"
)

func TestSuggestBilingualAndPortExtraction(t *testing.T) {
	// Vietnamese query with port extraction
	res := Suggest("tìm tiến trình đang chạy trên port 5173", 5)
	if len(res) == 0 {
		t.Fatal("expected suggestions for Vietnamese port query")
	}
	if res[0].ID != "port-find" {
		t.Fatalf("expected port-find first, got %+v", res[0])
	}
	if !strings.Contains(res[0].WindowsCmd, "5173") || !strings.Contains(res[0].UnixCmd, "5173") {
		t.Fatalf("expected extracted port 5173 in both OS commands: %+v", res[0])
	}
	if res[0].Verdict == "" {
		t.Fatalf("expected Command Firewall verdict populated: %+v", res[0])
	}

	// English Git undo query with count extraction
	resGit := Suggest("git undo last 3 commits", 5)
	if len(resGit) == 0 || resGit[0].ID != "git-undo-soft" || !strings.Contains(resGit[0].UnixCmd, "HEAD~3") {
		t.Fatalf("unexpected git undo suggestion: %+v", resGit)
	}

	// Vietnamese large file query
	resFiles := Suggest("tìm file lớn chiếm ổ cứng", 5)
	if len(resFiles) == 0 || resFiles[0].ID != "files-large" {
		t.Fatalf("expected files-large first, got %+v", resFiles)
	}

	// Empty query returns starter suggestions
	starter := Suggest("", 4)
	if len(starter) != 4 {
		t.Fatalf("expected 4 starter suggestions, got %d", len(starter))
	}
}
