// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package secretstore

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// A stand-in for what Electron's safeStorage left on disk: opaque bytes with no
// marker of ours.
var legacyBlob = []byte("v10\x8a\x1f\x00whatever safeStorage produced")

func readSecretsLocked(t *testing.T) map[string]string {
	t.Helper()
	lock.Lock()
	defer lock.Unlock()
	loaded, err := readSecretsFromFile()
	if err != nil {
		t.Fatalf("readSecretsFromFile: %v", err)
	}
	return loaded
}

func TestMigrationResealsAShellEncryptedFileAndKeepsABackup(t *testing.T) {
	dir := resetStore(t)
	secretsPath := filepath.Join(dir, SecretsFileName)
	backupPath := filepath.Join(dir, SecretsBackupName)
	stored := map[string]string{"OPENAI_KEY": "sk-legacy", "GH_TOKEN": "ghp_legacy"}
	plaintext, err := json.Marshal(stored)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(secretsPath, legacyBlob, 0600); err != nil {
		t.Fatalf("seeding the legacy file: %v", err)
	}

	shellCalls := 0
	decryptViaShell = func(data []byte) ([]byte, error) {
		shellCalls++
		if string(data) != string(legacyBlob) {
			t.Errorf("the shell was handed %q, not the file contents", data)
		}
		return plaintext, nil
	}

	loaded := readSecretsLocked(t)
	if shellCalls != 1 {
		t.Errorf("shell decrypt calls = %d, want 1", shellCalls)
	}
	for name, want := range stored {
		if loaded[name] != want {
			t.Errorf("secret %q = %q, want %q", name, loaded[name], want)
		}
	}

	// The original stays readable by the old shell in case anything about the new
	// scheme turns out to be wrong.
	backup, err := os.ReadFile(backupPath)
	if err != nil {
		t.Fatalf("no backup was written: %v", err)
	}
	if string(backup) != string(legacyBlob) {
		t.Error("the backup does not hold the original bytes")
	}

	migrated, err := os.ReadFile(secretsPath)
	if err != nil {
		t.Fatalf("reading the migrated file: %v", err)
	}
	if !isSealedByUs(migrated) {
		t.Fatal("the secrets file was not re-sealed in our own format")
	}
}

func TestMigratedSecretsStillOpenWithoutTheShell(t *testing.T) {
	// The whole point of migrating while Electron is still around: once the shell
	// is gone, nothing may need it to read the store.
	dir := resetStore(t)
	stored := map[string]string{"OPENAI_KEY": "sk-legacy"}
	plaintext, err := json.Marshal(stored)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, SecretsFileName), legacyBlob, 0600); err != nil {
		t.Fatalf("seeding the legacy file: %v", err)
	}
	decryptViaShell = func([]byte) ([]byte, error) { return plaintext, nil }
	readSecretsLocked(t)

	// Same process, but the shell is now unreachable, as it would be after the swap.
	decryptViaShell = func([]byte) ([]byte, error) {
		t.Error("the store asked the shell to decrypt an already-migrated file")
		return nil, errors.New("no shell")
	}
	// Drop the cached key too, so this exercises fetching it again as a fresh
	// process would.
	lock.Lock()
	cachedMasterKey = nil
	lock.Unlock()

	loaded := readSecretsLocked(t)
	if loaded["OPENAI_KEY"] != "sk-legacy" {
		t.Errorf("secret after migration = %q, want %q", loaded["OPENAI_KEY"], "sk-legacy")
	}
}

func TestMigrationLeavesTheFileAloneWhenTheShellCannotDecryptIt(t *testing.T) {
	dir := resetStore(t)
	secretsPath := filepath.Join(dir, SecretsFileName)
	if err := os.WriteFile(secretsPath, legacyBlob, 0600); err != nil {
		t.Fatalf("seeding the legacy file: %v", err)
	}
	decryptViaShell = func([]byte) ([]byte, error) { return nil, errors.New("safeStorage unavailable") }

	lock.Lock()
	_, err := readSecretsFromFile()
	lock.Unlock()
	if err == nil {
		t.Fatal("a failed migration reported success")
	}

	contents, readErr := os.ReadFile(secretsPath)
	if readErr != nil {
		t.Fatalf("reading the file back: %v", readErr)
	}
	if string(contents) != string(legacyBlob) {
		t.Error("the unreadable file was overwritten, losing the only copy of the secrets")
	}
}

func TestWriteThenReadRoundTripsThroughTheFile(t *testing.T) {
	resetStore(t)
	lock.Lock()
	secrets = map[string]string{"A_TOKEN": "value-one", "B_TOKEN": "value-two"}
	lock.Unlock()

	if err := writeSecretsToFile(); err != nil {
		t.Fatalf("writeSecretsToFile: %v", err)
	}

	lock.Lock()
	secrets = make(map[string]string)
	cachedMasterKey = nil
	lock.Unlock()

	loaded := readSecretsLocked(t)
	if loaded["A_TOKEN"] != "value-one" || loaded["B_TOKEN"] != "value-two" {
		t.Errorf("round trip lost values: %v", loaded)
	}
	if loaded[WriteTsKey] == "" {
		t.Error("the write timestamp was not recorded")
	}
}

func TestFirstRunWithNoFileStillResolvesABackend(t *testing.T) {
	resetStore(t)
	if loaded := readSecretsLocked(t); len(loaded) != 0 {
		t.Errorf("a fresh store is not empty: %v", loaded)
	}
	backend, err := GetLinuxStorageBackend()
	if err != nil {
		t.Fatalf("GetLinuxStorageBackend: %v", err)
	}
	if backend != KeyBackendKeyring {
		t.Errorf("backend = %q, want %q", backend, KeyBackendKeyring)
	}
}
