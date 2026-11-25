// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package projectdetect

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInspectAndEnsureWorktreeInclude(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"scripts":{"dev":"vite","test":"vitest"},"devDependencies":{"vite":"^6.0.0"}}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "go.mod"), []byte("module demo\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "CLAUDE.md"), []byte("# Claude\n"), 0644); err != nil {
		t.Fatal(err)
	}

	rep, err := Inspect(dir)
	if err != nil {
		t.Fatalf("Inspect failed: %v", err)
	}
	if !rep.HasClaudeMD || rep.HasWorktreeInclude {
		t.Fatalf("unexpected readiness flags: %+v", rep)
	}
	if len(rep.Stacks) < 3 || len(rep.Commands) < 4 {
		t.Fatalf("expected Node+Vite+Go stacks and >=4 commands, got %+v", rep)
	}

	p, created, err := EnsureWorktreeInclude(dir)
	if err != nil || !created {
		t.Fatalf("EnsureWorktreeInclude failed: path=%q created=%v err=%v", p, created, err)
	}
	_, created2, err := EnsureWorktreeInclude(dir)
	if err != nil || created2 {
		t.Fatalf("expected second EnsureWorktreeInclude to be no-op, created=%v err=%v", created2, err)
	}
}
