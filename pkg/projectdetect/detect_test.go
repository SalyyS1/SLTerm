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
	if err := os.WriteFile(filepath.Join(dir, ".env.example"), []byte("# template\nOPENAI_API_KEY=\nDATABASE_URL=postgres://localhost/db\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("DATABASE_URL=super-secret-value-never-leak\n"), 0600); err != nil {
		t.Fatal(err)
	}

	rep, err := Inspect(dir)
	if err != nil {
		t.Fatalf("Inspect failed: %v", err)
	}
	if !rep.HasClaudeMD || rep.HasWorktreeInclude {
		t.Fatalf("unexpected readiness flags: %+v", rep)
	}
	if rep.EnvExampleCount != 2 || len(rep.MissingEnvKeys) != 1 || rep.MissingEnvKeys[0] != "OPENAI_API_KEY" {
		t.Fatalf("unexpected env drift report: count=%d missing=%+v", rep.EnvExampleCount, rep.MissingEnvKeys)
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

	// Inline context editor allowlist guard: must reject .env and traversal, allow AGENTS.md.
	if _, _, err := ReadContextFile(dir, ".env"); err == nil {
		t.Fatal("expected .env to be rejected by context file allowlist")
	}
	if _, err := WriteContextFile(dir, "../escape.txt", "bad"); err == nil {
		t.Fatal("expected path traversal to be rejected")
	}
	tmpl, exists, err := ReadContextFile(dir, "AGENTS.md")
	if err != nil || exists || tmpl == "" {
		t.Fatalf("expected starter template for missing AGENTS.md, exists=%v err=%v", exists, err)
	}
	if _, err := WriteContextFile(dir, "AGENTS.md", "# Custom Rules\n"); err != nil {
		t.Fatalf("WriteContextFile failed: %v", err)
	}
	got, exists2, err := ReadContextFile(dir, "AGENTS.md")
	if err != nil || !exists2 || got != "# Custom Rules\n" {
		t.Fatalf("unexpected ReadContextFile after write: got=%q exists=%v err=%v", got, exists2, err)
	}
}
