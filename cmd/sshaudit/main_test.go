// Copyright 2026, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCLIAuditAndSarifAndRedact(t *testing.T) {
	var out, errBuf bytes.Buffer
	code := run([]string{"--version"}, strings.NewReader(""), &out, &errBuf)
	if code != 0 || !strings.Contains(out.String(), "0.23.0") {
		t.Fatalf("unexpected version output: code=%d out=%q", code, out.String())
	}

	out.Reset()
	errBuf.Reset()
	sarifPath := filepath.Join(t.TempDir(), "audit.sarif")
	cfg := "Host *\n    StrictHostKeyChecking no\n"
	code = run([]string{"audit", "-", "--json", "--sarif", sarifPath}, strings.NewReader(cfg), &out, &errBuf)
	if code != 1 {
		t.Fatalf("expected exit code 1 on error finding, got %d (stderr=%s)", code, errBuf.String())
	}
	var rep map[string]any
	if err := json.Unmarshal(out.Bytes(), &rep); err != nil {
		t.Fatalf("invalid audit JSON: %v", err)
	}
	if _, err := os.Stat(sarifPath); err != nil {
		t.Fatalf("expected SARIF output file at %s: %v", sarifPath, err)
	}

	// Redact subcommand
	out.Reset()
	errBuf.Reset()
	tok := "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
	code = run([]string{"redact", "-", "--json"}, strings.NewReader("GITHUB_TOKEN="+tok+"\n"), &out, &errBuf)
	if code != 0 {
		t.Fatalf("expected exit code 0 on redact, got %d", code)
	}
	if strings.Contains(out.String(), tok) {
		t.Fatalf("redact JSON leaked token: %s", out.String())
	}
}
