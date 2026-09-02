// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package secretstore

import (
	"bytes"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/zalando/go-keyring"
)

func TestMasterKeyUsesTheKeyringAndReturnsTheSameKeyTwice(t *testing.T) {
	resetStore(t)

	key, backend, err := loadOrCreateMasterKey()
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if backend != KeyBackendKeyring {
		t.Errorf("backend = %q, want %q", backend, KeyBackendKeyring)
	}
	if _, statErr := os.Stat(masterKeyPath()); statErr == nil {
		t.Errorf("a key file was written even though the keyring worked")
	}

	again, backend2, err := loadOrCreateMasterKey()
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if backend2 != KeyBackendKeyring {
		t.Errorf("second backend = %q, want %q", backend2, KeyBackendKeyring)
	}
	if !bytes.Equal(key, again) {
		t.Error("a second call produced a different key, which would orphan every stored secret")
	}
}

func TestMasterKeyFallsBackToAFileWithoutAKeyring(t *testing.T) {
	resetStore(t)
	keyring.MockInitWithError(errors.New("no D-Bus session"))

	key, backend, err := loadOrCreateMasterKey()
	if err != nil {
		t.Fatalf("loadOrCreateMasterKey: %v", err)
	}
	if backend != KeyBackendFile {
		t.Errorf("backend = %q, want %q", backend, KeyBackendFile)
	}

	info, err := os.Stat(masterKeyPath())
	if err != nil {
		t.Fatalf("no key file was written: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Errorf("key file mode = %04o, want 0600", perm)
	}

	again, backend2, err := loadOrCreateMasterKey()
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if backend2 != KeyBackendFile || !bytes.Equal(key, again) {
		t.Errorf("second call did not reuse the key file (backend %q, same key %v)", backend2, bytes.Equal(key, again))
	}
}

func TestMasterKeyPrefersAnExistingFileOverANewKeyringEntry(t *testing.T) {
	// The trap this guards: a machine that once had no keyring wrote a key file,
	// then gained one. Minting a fresh keyring key would leave every secret in the
	// file sealed under a key nothing looks for any more.
	resetStore(t)
	keyring.MockInitWithError(errors.New("no D-Bus session"))
	fileKey, _, err := loadOrCreateMasterKey()
	if err != nil {
		t.Fatalf("creating the fallback key: %v", err)
	}

	keyring.MockInit() // the keyring is available now
	key, backend, err := loadOrCreateMasterKey()
	if err != nil {
		t.Fatalf("loadOrCreateMasterKey: %v", err)
	}
	if backend != KeyBackendFile {
		t.Errorf("backend = %q, want %q: the working key file must win", backend, KeyBackendFile)
	}
	if !bytes.Equal(fileKey, key) {
		t.Error("the key changed, which would orphan every stored secret")
	}
}

func TestMasterKeyRefusesToReplaceAnUnreadableKeyFile(t *testing.T) {
	// Overwriting it would make the secrets it sealed unrecoverable, so this has
	// to fail loudly and leave the file alone for the user to restore.
	dir := resetStore(t)
	if err := os.WriteFile(filepath.Join(dir, MasterKeyFileName), []byte("not base64 at all!!"), 0600); err != nil {
		t.Fatalf("seeding a corrupt key file: %v", err)
	}

	if _, _, err := loadOrCreateMasterKey(); err == nil {
		t.Fatal("a corrupt key file was accepted")
	}
	contents, err := os.ReadFile(filepath.Join(dir, MasterKeyFileName))
	if err != nil {
		t.Fatalf("reading the key file back: %v", err)
	}
	if string(contents) != "not base64 at all!!" {
		t.Error("the corrupt key file was overwritten instead of reported")
	}
}

func TestMasterKeyReplacesACorruptKeyringEntry(t *testing.T) {
	// Unlike a key file, a keyring entry that cannot be decoded has no recovery
	// value: it opens nothing. Refusing to start would just wedge the app.
	resetStore(t)
	if err := keyring.Set(keyringService, keyringUser, "!!! not base64"); err != nil {
		t.Fatalf("seeding a corrupt keyring entry: %v", err)
	}

	key, backend, err := loadOrCreateMasterKey()
	if err != nil {
		t.Fatalf("loadOrCreateMasterKey: %v", err)
	}
	if backend != KeyBackendKeyring {
		t.Errorf("backend = %q, want %q", backend, KeyBackendKeyring)
	}
	stored, err := keyring.Get(keyringService, keyringUser)
	if err != nil {
		t.Fatalf("reading the replaced entry: %v", err)
	}
	if stored != base64.StdEncoding.EncodeToString(key) {
		t.Error("the corrupt entry was not replaced with the key that was returned")
	}
}
