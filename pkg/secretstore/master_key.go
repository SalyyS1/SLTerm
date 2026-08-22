// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package secretstore

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/SalyyS1/SLTerm/pkg/wavebase"
	"github.com/zalando/go-keyring"
	"golang.org/x/crypto/chacha20poly1305"
)

const (
	// Where the OS keyring files this under. Visible to the user in Keychain
	// Access, Credential Manager or Seahorse, so it is named for what it is.
	keyringService = "SLTerm"
	keyringUser    = "secrets-master-key"

	// MasterKeyFileName holds the key when no OS keyring is reachable.
	MasterKeyFileName = "secrets.key"

	// Backends the master key can live in, reported so the UI can tell the user
	// how well their secrets are protected.
	KeyBackendKeyring = "os-keyring"
	KeyBackendFile    = "config-file"
)

// loadOrCreateMasterKey returns the key the secrets file is sealed under, and
// where that key is kept.
//
// The OS keyring is the goal: on a desktop it ties the key to the login session
// so a stolen config directory is not enough to read the secrets. But a keyring
// needs a running agent, and plenty of real setups have none — a headless Linux
// box, an SSH session with no D-Bus, a locked keyring. Electron's safeStorage had
// the same problem and quietly fell back to a hardcoded key; falling back to a
// 0600 file is no weaker than that and is at least reported honestly.
func loadOrCreateMasterKey() ([]byte, string, error) {
	// An existing key file wins, always. Promoting it into the keyring would mean
	// either deleting a key that currently works — losing every secret if the
	// keyring entry is ever cleared — or leaving a second copy behind in the
	// weaker store. Neither is worth it for a machine that has already shown it
	// had no keyring when the key was made.
	key, err := readMasterKeyFile()
	switch {
	case err == nil:
		return key, KeyBackendFile, nil
	case !errors.Is(err, os.ErrNotExist):
		// A key file that is there but unreadable has to stop everything: the
		// secrets it sealed cannot be recovered without it, and quietly writing a
		// new one would orphan them for good.
		return nil, "", err
	}

	stored, keyringErr := keyring.Get(keyringService, keyringUser)
	if keyringErr == nil {
		key, decodeErr := decodeMasterKey(stored)
		if decodeErr == nil {
			return key, KeyBackendKeyring, nil
		}
		// A corrupt entry is worse than none: nothing opens with it, and refusing
		// to start would leave the user no way forward. Replace it.
		log.Printf("secretstore: keyring entry is unusable, replacing it: %v\n", decodeErr)
	} else if !errors.Is(keyringErr, keyring.ErrNotFound) {
		log.Printf("secretstore: no usable OS keyring (%v), keeping the master key in a file instead\n", keyringErr)
		return createMasterKeyFile()
	}

	newKey := make([]byte, chacha20poly1305.KeySize)
	if _, err := rand.Read(newKey); err != nil {
		return nil, "", fmt.Errorf("cannot generate a master key: %w", err)
	}
	if err := keyring.Set(keyringService, keyringUser, base64.StdEncoding.EncodeToString(newKey)); err != nil {
		log.Printf("secretstore: cannot write to the OS keyring (%v), keeping the master key in a file instead\n", err)
		return createMasterKeyFile()
	}
	return newKey, KeyBackendKeyring, nil
}

func masterKeyPath() string {
	return filepath.Join(wavebase.GetWaveConfigDir(), MasterKeyFileName)
}

func readMasterKeyFile() ([]byte, error) {
	contents, err := os.ReadFile(masterKeyPath())
	if err != nil {
		return nil, err
	}
	key, err := decodeMasterKey(string(contents))
	if err != nil {
		return nil, fmt.Errorf("%s is unusable: %w", MasterKeyFileName, err)
	}
	return key, nil
}

func createMasterKeyFile() ([]byte, string, error) {
	key := make([]byte, chacha20poly1305.KeySize)
	if _, err := rand.Read(key); err != nil {
		return nil, "", fmt.Errorf("cannot generate a master key: %w", err)
	}
	encoded := base64.StdEncoding.EncodeToString(key)
	if err := writeFileAtomic(masterKeyPath(), []byte(encoded)); err != nil {
		return nil, "", fmt.Errorf("cannot write %s: %w", MasterKeyFileName, err)
	}
	return key, KeyBackendFile, nil
}

func decodeMasterKey(encoded string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
	if err != nil {
		return nil, fmt.Errorf("not valid base64: %w", err)
	}
	if len(key) != chacha20poly1305.KeySize {
		return nil, fmt.Errorf("wrong length: got %d bytes, want %d", len(key), chacha20poly1305.KeySize)
	}
	return key, nil
}
