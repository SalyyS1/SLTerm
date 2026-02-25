// Copyright 2025, Salyvn.
// SPDX-License-Identifier: Apache-2.0

package wstore

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
	"time"

	"github.com/jmoiron/sqlx"
	"github.com/sawka/txwrap"
	"github.com/SalyyS1/SLTerm/pkg/util/migrateutil"
	"github.com/SalyyS1/SLTerm/pkg/wavebase"
	"github.com/SalyyS1/SLTerm/pkg/waveobj"

	dbfs "github.com/SalyyS1/SLTerm/db"
)

const WStoreDBName = "slterm.db"

type TxWrap = txwrap.TxWrap

var globalDB *sqlx.DB

func InitWStore() error {
	ctx, cancelFn := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancelFn()
	var err error
	globalDB, err = MakeDB(ctx)
	if err != nil {
		return err
	}
	err = migrateutil.Migrate("wstore", globalDB.DB, dbfs.WStoreMigrationFS, "migrations-wstore")
	if err != nil {
		return err
	}
	log.Printf("wstore initialized\n")
	return nil
}

func GetDBName() string {
	waveHome := wavebase.GetWaveDataDir()
	return filepath.Join(waveHome, wavebase.WaveDBDir, WStoreDBName)
}

// sqlitePragmas contains additional PRAGMAs applied after open.
// WAL and busy_timeout are already set via DSN params; these cover the remaining tuning.
var sqlitePragmas = []string{
	"PRAGMA synchronous=NORMAL",        // WAL + NORMAL is safe and faster than FULL
	"PRAGMA cache_size=-64000",         // 64MB page cache (negative = KB)
	"PRAGMA mmap_size=268435456",       // 256MB memory-mapped I/O
	"PRAGMA wal_autocheckpoint=1000",   // checkpoint every 1000 WAL pages
	"PRAGMA temp_store=MEMORY",         // keep temp tables in RAM
}

func MakeDB(ctx context.Context) (*sqlx.DB, error) {
	dbName := GetDBName()
	// WAL mode and busy_timeout are set via DSN to apply before any connection use.
	rtn, err := sqlx.Open("sqlite3", fmt.Sprintf("file:%s?mode=rwc&_journal_mode=WAL&_busy_timeout=5000", dbName))
	if err != nil {
		return nil, err
	}
	rtn.DB.SetMaxOpenConns(1)
	if err := applyPragmas(rtn); err != nil {
		rtn.DB.Close()
		return nil, err
	}
	return rtn, nil
}

// applyPragmas executes the additional SQLite PRAGMAs after the connection is established.
func applyPragmas(db *sqlx.DB) error {
	for _, pragma := range sqlitePragmas {
		if _, err := db.Exec(pragma); err != nil {
			return fmt.Errorf("sqlite pragma error (%s): %w", pragma, err)
		}
	}
	return nil
}

func WithTx(ctx context.Context, fn func(tx *TxWrap) error) (rtnErr error) {
	waveobj.ContextUpdatesBeginTx(ctx)
	defer func() {
		if rtnErr != nil {
			waveobj.ContextUpdatesRollbackTx(ctx)
		} else {
			waveobj.ContextUpdatesCommitTx(ctx)
		}
	}()
	return txwrap.WithTx(ctx, globalDB, fn)
}

func WithTxRtn[RT any](ctx context.Context, fn func(tx *TxWrap) (RT, error)) (rtnVal RT, rtnErr error) {
	waveobj.ContextUpdatesBeginTx(ctx)
	defer func() {
		if rtnErr != nil {
			waveobj.ContextUpdatesRollbackTx(ctx)
		} else {
			waveobj.ContextUpdatesCommitTx(ctx)
		}
	}()
	return txwrap.WithTxRtn(ctx, globalDB, fn)
}
