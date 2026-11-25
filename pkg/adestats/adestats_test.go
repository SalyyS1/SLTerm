// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package adestats

import (
	"context"
	"testing"
)

func TestParseTasklistAndUnixPS(t *testing.T) {
	winCSV := `"claude.exe","5120","Console","1","82,400 K"
"node.exe","8120","Console","1","140,000 K"
"explorer.exe","1200","Console","1","90,000 K"
`
	wProcs := ParseWindowsTasklist(winCSV)
	if len(wProcs) != 2 {
		t.Fatalf("expected 2 tracked Windows processes, got %+v", wProcs)
	}
	if wProcs[0].Name != "claude.exe" || wProcs[0].Role != "agent" || wProcs[0].RSSMB < 80 {
		t.Fatalf("expected claude.exe agent first, got %+v", wProcs[0])
	}

	unixPS := `  410 65536 codex
  912 102400 vite
  101 12000 systemd
`
	uProcs := ParseUnixPS(unixPS)
	if len(uProcs) != 2 || uProcs[0].Name != "codex" || uProcs[0].Role != "agent" {
		t.Fatalf("unexpected unix processes: %+v", uProcs)
	}

	snap := Collect(context.Background())
	if snap.SidecarSysMB <= 0 || snap.Goroutines <= 0 {
		t.Fatalf("expected valid runtime snapshot, got %+v", snap)
	}
}
