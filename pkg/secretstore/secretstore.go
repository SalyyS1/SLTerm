// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package secretstore

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/SalyyS1/SLTerm/pkg/wavebase"
	"github.com/SalyyS1/SLTerm/pkg/wshrpc"
	"github.com/SalyyS1/SLTerm/pkg/wshrpc/wshclient"
	"github.com/SalyyS1/SLTerm/pkg/wshutil"
)

const (
	SecretsFileName   = "secrets.enc"
	SecretsBackupName = "secrets.enc.pre-keyring"
	WriteDebounceMs   = 1000
	EncryptionTimeout = 5000
	InitRetryMs       = 1000
	SecretNamePattern = `^[A-Za-z][A-Za-z0-9_]*$`
	WriteTsKey        = "wave:writets"
)

var lock sync.Mutex
var secrets = make(map[string]string)
var writeRequestChan chan struct{}
var initialized bool
var lastInitTryTime time.Time
var lastInitErr error
var secretNameRegexp = regexp.MustCompile(SecretNamePattern)
var cachedMasterKey []byte
var cachedKeyBackend string

// must hold lock
func masterKey() ([]byte, error) {
	if cachedMasterKey != nil {
		return cachedMasterKey, nil
	}
	key, backend, err := loadOrCreateMasterKey()
	if err != nil {
		return nil, err
	}
	cachedMasterKey = key
	cachedKeyBackend = backend
	return key, nil
}

// writeFileAtomic replaces a file in one step, so a crash mid-write cannot leave
// a half-written one behind.
//
// This file is the only copy of the user's secrets, and the key file is the only
// thing that opens it — neither can afford a torn write.
func writeFileAtomic(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// must hold lock
func readSecretsFromFile() (map[string]string, error) {
	secretsPath := filepath.Join(wavebase.GetWaveConfigDir(), SecretsFileName)

	fileData, err := os.ReadFile(secretsPath)
	if err != nil {
		if !os.IsNotExist(err) {
			log.Printf("secretstore: could not read secrets file: %v\n", err)
		}
		// Resolve the key even with nothing to read, so the backend is known and
		// the first write cannot fail on a key that was never obtainable.
		if _, keyErr := masterKey(); keyErr != nil {
			log.Printf("secretstore: could not obtain a master key: %v\n", keyErr)
		}
		return make(map[string]string), nil
	}

	if !isSealedByUs(fileData) {
		return migrateFromShellEncryption(secretsPath, fileData)
	}

	key, err := masterKey()
	if err != nil {
		return nil, err
	}
	plaintext, err := openSecrets(key, string(fileData))
	if err != nil {
		return nil, err
	}
	return parseSecrets(plaintext)
}

func parseSecrets(plaintext []byte) (map[string]string, error) {
	var parsed map[string]string
	if err := json.Unmarshal(plaintext, &parsed); err != nil {
		return nil, fmt.Errorf("failed to parse secrets: %w", err)
	}
	return parsed, nil
}

// migrateFromShellEncryption re-seals a secrets file that Electron's safeStorage
// wrote, under a key this process owns.
//
// This has to happen while the Electron shell is still there to decrypt it. Once
// the shell is replaced, the `electron` rpc route is gone and a file in the old
// format can never be opened again — so the migration runs at the first read, not
// on demand, and writes through synchronously instead of waiting for the debounced
// writer. The original file is kept as a backup: if anything about the new scheme
// is wrong, the old shell can still read it.
//
// must hold lock
func migrateFromShellEncryption(secretsPath string, fileData []byte) (map[string]string, error) {
	log.Printf("secretstore: secrets file predates the keyring, migrating it\n")
	plaintext, err := decryptViaShell(fileData)
	if err != nil {
		// The likely cause is running a build whose shell can no longer answer:
		// the file is only openable by the safeStorage key Electron held. Say so,
		// because the way out is to open it once under the old build, not to
		// delete anything.
		return nil, fmt.Errorf("cannot migrate %s: it was encrypted by the Electron shell, which did not answer (%w) — "+
			"open this profile once under an Electron build of SLTerm to migrate it", SecretsFileName, err)
	}
	parsed, err := parseSecrets(plaintext)
	if err != nil {
		return nil, err
	}

	backupPath := filepath.Join(wavebase.GetWaveConfigDir(), SecretsBackupName)
	if err := writeFileAtomic(backupPath, fileData); err != nil {
		// No backup, no migration: overwriting the only readable copy without one
		// would risk the user's secrets on the first run of new code.
		return nil, fmt.Errorf("cannot back up the secrets file before migrating: %w", err)
	}

	key, err := masterKey()
	if err != nil {
		return nil, err
	}
	sealed, err := sealSecrets(key, plaintext)
	if err != nil {
		return nil, err
	}
	if err := writeFileAtomic(secretsPath, []byte(sealed)); err != nil {
		return nil, fmt.Errorf("cannot write the migrated secrets file: %w", err)
	}
	log.Printf("secretstore: migrated %d secret(s) to the %s backend, old file kept as %s\n",
		len(parsed), cachedKeyBackend, SecretsBackupName)
	return parsed, nil
}

// decryptViaShell asks the Electron shell to open a legacy blob with the
// safeStorage key that sealed it. The only caller is the one-time migration.
//
// A variable so tests can exercise that migration; they have no shell to ask.
var decryptViaShell = func(fileData []byte) ([]byte, error) {
	rpcClient := wshclient.GetBareRpcClient()
	result, err := wshclient.ElectronDecryptCommand(rpcClient,
		wshrpc.CommandElectronDecryptData{CipherText: string(fileData)},
		&wshrpc.RpcOpts{Route: wshutil.HostRoute, Timeout: EncryptionTimeout})
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt secrets: %w", err)
	}
	return []byte(result.PlainText), nil
}

func initSecretStore() error {
	lock.Lock()
	defer lock.Unlock()
	if initialized {
		return nil
	}

	now := time.Now()
	if !lastInitTryTime.IsZero() && now.Sub(lastInitTryTime) < InitRetryMs*time.Millisecond {
		return lastInitErr
	}

	lastInitTryTime = now
	loadedSecrets, err := readSecretsFromFile()
	if err != nil {
		lastInitErr = err
		return err
	}
	secrets = loadedSecrets

	writeRequestChan = make(chan struct{}, 1)
	initialized = true
	lastInitErr = nil
	go writerLoop()
	return nil
}

func writerLoop() {
	var timer *time.Timer
	for range writeRequestChan {
		if timer != nil {
			timer.Stop()
		}
		timer = time.AfterFunc(WriteDebounceMs*time.Millisecond, func() {
			if err := writeSecretsToFile(); err != nil {
				log.Printf("secretstore: error writing secrets: %v\n", err)
			}
		})
	}
}

func writeSecretsToFile() error {
	lock.Lock()
	secretsCopy := make(map[string]string, len(secrets)+1)
	for k, v := range secrets {
		secretsCopy[k] = v
	}
	secretsCopy[WriteTsKey] = time.Now().UTC().Format(time.RFC3339)
	key, keyErr := masterKey()
	lock.Unlock()

	if keyErr != nil {
		return keyErr
	}
	jsonData, err := json.Marshal(secretsCopy)
	if err != nil {
		return fmt.Errorf("failed to marshal secrets: %w", err)
	}
	sealed, err := sealSecrets(key, jsonData)
	if err != nil {
		return err
	}
	secretsPath := filepath.Join(wavebase.GetWaveConfigDir(), SecretsFileName)
	if err := writeFileAtomic(secretsPath, []byte(sealed)); err != nil {
		return fmt.Errorf("failed to write secrets file: %w", err)
	}
	return nil
}

func requestWrite() {
	select {
	case writeRequestChan <- struct{}{}:
	default:
	}
}

func SetSecret(name string, value string) error {
	if name == "" {
		return fmt.Errorf("secret name cannot be empty")
	}
	if !secretNameRegexp.MatchString(name) {
		return fmt.Errorf("secret name must start with a letter and contain only letters, numbers, and underscores")
	}
	if err := initSecretStore(); err != nil {
		return err
	}
	lock.Lock()
	defer lock.Unlock()

	secrets[name] = strings.TrimRight(value, "\r\n")
	requestWrite()
	return nil
}

func DeleteSecret(name string) error {
	if name == "" {
		return fmt.Errorf("secret name cannot be empty")
	}
	if err := initSecretStore(); err != nil {
		return err
	}
	lock.Lock()
	defer lock.Unlock()

	delete(secrets, name)
	requestWrite()
	return nil
}

func GetSecret(name string) (string, bool, error) {
	if name == WriteTsKey {
		return "", false, nil
	}
	if err := initSecretStore(); err != nil {
		return "", false, err
	}
	lock.Lock()
	defer lock.Unlock()

	value, exists := secrets[name]
	return value, exists, nil
}

func GetSecretNames() ([]string, error) {
	if err := initSecretStore(); err != nil {
		return nil, err
	}
	lock.Lock()
	defer lock.Unlock()

	names := make([]string, 0, len(secrets))
	for name := range secrets {
		if name == WriteTsKey {
			continue
		}
		names = append(names, name)
	}
	return names, nil
}

func CountSecrets() (int, error) {
	lock.Lock()
	defer lock.Unlock()

	if !initialized {
		return 0, fmt.Errorf("secret store not initialized")
	}

	count := 0
	for name := range secrets {
		if name == WriteTsKey {
			continue
		}
		count++
	}
	return count, nil
}

// GetLinuxStorageBackend reports where the master key is kept.
//
// Named for the Electron-era question it used to answer — which safeStorage
// backend Linux had picked — because that name is on the wire as
// `getsecretslinuxstoragebackend`. It now answers the question that actually
// matters on every platform: whether the key protecting the secrets file lives in
// the OS keyring or in a file beside it. See KeyBackendKeyring / KeyBackendFile.
func GetLinuxStorageBackend() (string, error) {
	lock.Lock()
	defer lock.Unlock()

	if cachedKeyBackend != "" {
		return cachedKeyBackend, nil
	}
	if _, err := masterKey(); err != nil {
		return "", err
	}
	return cachedKeyBackend, nil
}
