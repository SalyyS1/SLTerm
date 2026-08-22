// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package secretstore

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"

	"golang.org/x/crypto/chacha20poly1305"
)

// EnvelopeMagic marks a secrets file this package sealed itself.
//
// The file used to hold whatever Electron's safeStorage produced, which is opaque
// and differs per platform. A magic prefix is what lets one build read both
// shapes: no prefix means the blob predates the migration and still needs the
// shell to open it.
const EnvelopeMagic = "SLTERM-SECRETS-1:"

// sealSecrets encrypts with XChaCha20-Poly1305 under a fresh random nonce.
//
// The nonce is 24 bytes, so drawing it at random cannot realistically repeat even
// across the lifetime of a key that is never rotated. Authentication matters as
// much as secrecy here: without it, an attacker who can write the file could flip
// bits in a stored token and the store would hand the result to an SSH session.
func sealSecrets(key []byte, plaintext []byte) (string, error) {
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return "", fmt.Errorf("cannot use the master key: %w", err)
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("cannot draw a nonce: %w", err)
	}
	sealed := aead.Seal(nonce, nonce, plaintext, nil)
	return EnvelopeMagic + base64.StdEncoding.EncodeToString(sealed), nil
}

// openSecrets reverses sealSecrets, and fails rather than guessing on any file it
// did not write.
func openSecrets(key []byte, data string) ([]byte, error) {
	body, found := strings.CutPrefix(strings.TrimSpace(data), EnvelopeMagic)
	if !found {
		return nil, fmt.Errorf("not a sealed secrets file")
	}
	sealed, err := base64.StdEncoding.DecodeString(body)
	if err != nil {
		return nil, fmt.Errorf("secrets file is not valid base64: %w", err)
	}
	aead, err := chacha20poly1305.NewX(key)
	if err != nil {
		return nil, fmt.Errorf("cannot use the master key: %w", err)
	}
	if len(sealed) < aead.NonceSize() {
		return nil, fmt.Errorf("secrets file is truncated")
	}
	nonce, ciphertext := sealed[:aead.NonceSize()], sealed[aead.NonceSize():]
	plaintext, err := aead.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		// Either the wrong key or a modified file; the caller cannot tell them
		// apart and must not fall back to trusting the contents.
		return nil, fmt.Errorf("secrets file does not open with this key: %w", err)
	}
	return plaintext, nil
}

// isSealedByUs reports whether the file is in this package's format, and so does
// not need the shell to decrypt it.
func isSealedByUs(data []byte) bool {
	return strings.HasPrefix(strings.TrimSpace(string(data)), EnvelopeMagic)
}
