// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package secretstore

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/SalyyS1/SLTerm/pkg/wavebase"
	"github.com/zalando/go-keyring"
)

// resetStore points the store at a scratch config dir and clears the package
// state, so each test starts from a machine that has never held a secret.
func resetStore(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	prevConfig := wavebase.ConfigHome_VarCache
	prevDecrypt := decryptViaShell
	wavebase.ConfigHome_VarCache = dir
	t.Cleanup(func() {
		wavebase.ConfigHome_VarCache = prevConfig
		decryptViaShell = prevDecrypt
		lock.Lock()
		defer lock.Unlock()
		secrets = make(map[string]string)
		initialized = false
		lastInitErr = nil
		lastInitTryTime = time.Time{}
		cachedMasterKey = nil
		cachedKeyBackend = ""
	})
	lock.Lock()
	secrets = make(map[string]string)
	initialized = false
	cachedMasterKey = nil
	cachedKeyBackend = ""
	lock.Unlock()
	keyring.MockInit()
	return dir
}

func testKey(t *testing.T) []byte {
	t.Helper()
	lock.Lock()
	defer lock.Unlock()
	key, err := masterKey()
	if err != nil {
		t.Fatalf("could not obtain a master key: %v", err)
	}
	return key
}

func TestEnvelopeRoundTrip(t *testing.T) {
	resetStore(t)
	key := testKey(t)
	plaintext := []byte(`{"OPENAI_KEY":"sk-secret","wave:writets":"2026-08-22T00:00:00Z"}`)

	sealed, err := sealSecrets(key, plaintext)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	if !isSealedByUs([]byte(sealed)) {
		t.Error("sealed output is not recognized as our own format")
	}
	if strings.Contains(sealed, "sk-secret") {
		t.Error("the secret appears verbatim in the sealed output")
	}

	opened, err := openSecrets(key, sealed)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if string(opened) != string(plaintext) {
		t.Errorf("round trip mismatch:\n got %s\nwant %s", opened, plaintext)
	}
}

func TestEnvelopeRefusesTheWrongKey(t *testing.T) {
	resetStore(t)
	key := testKey(t)
	sealed, err := sealSecrets(key, []byte(`{"A":"1"}`))
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	otherKey := make([]byte, len(key))
	copy(otherKey, key)
	otherKey[0] ^= 0xff
	if _, err := openSecrets(otherKey, sealed); err == nil {
		t.Error("a file opened with the wrong key")
	}
}

func TestEnvelopeRefusesATamperedFile(t *testing.T) {
	resetStore(t)
	key := testKey(t)
	sealed, err := sealSecrets(key, []byte(`{"A":"1"}`))
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	// Flip a bit inside the ciphertext. Without authentication this would decrypt
	// to something the store would then hand out as a credential.
	body := strings.TrimPrefix(sealed, EnvelopeMagic)
	raw, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	raw[len(raw)-1] ^= 0x01
	tampered := EnvelopeMagic + base64.StdEncoding.EncodeToString(raw)

	if _, err := openSecrets(key, tampered); err == nil {
		t.Error("a tampered file opened")
	}
}

func TestIsSealedByUsRejectsAShellEncryptedFile(t *testing.T) {
	// What Electron's safeStorage produced on Linux: a "v10" prefix, then bytes.
	if isSealedByUs([]byte("v10\x8a\x1f\x00binary")) {
		t.Error("a safeStorage blob was mistaken for our format")
	}
	if isSealedByUs(nil) {
		t.Error("an empty file was mistaken for our format")
	}
}
