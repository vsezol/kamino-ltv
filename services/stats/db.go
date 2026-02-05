package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	Pool *pgxpool.Pool
}

func initDB(ctx context.Context, env Env) (*DB, error) {
	pool, err := pgxpool.New(ctx, env.DatabaseURL)
	if err != nil {
		return nil, err
	}

	db := &DB{Pool: pool}
	if err := db.applyMigrations(ctx, env.MigrationsPath); err != nil {
		pool.Close()
		return nil, err
	}

	return db, nil
}

func (db *DB) Close() {
	db.Pool.Close()
}

func (db *DB) applyMigrations(ctx context.Context, migrationsPath string) error {
	entries, err := os.ReadDir(migrationsPath)
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}

	migrationFiles := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if strings.HasSuffix(entry.Name(), ".sql") {
			migrationFiles = append(migrationFiles, entry.Name())
		}
	}
	sort.Strings(migrationFiles)

	if len(migrationFiles) == 0 {
		return errors.New("no migration files found")
	}

	_, err = db.Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS _migrations (
			name TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		);
	`)
	if err != nil {
		return fmt.Errorf("create _migrations: %w", err)
	}

	for _, fileName := range migrationFiles {
		if err := db.applyMigrationFile(ctx, migrationsPath, fileName); err != nil {
			return err
		}
	}

	return nil
}

func (db *DB) applyMigrationFile(ctx context.Context, migrationsPath, fileName string) error {
	var exists bool
	err := db.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM _migrations WHERE name=$1)`, fileName).Scan(&exists)
	if err != nil {
		return fmt.Errorf("check migration %s: %w", fileName, err)
	}
	if exists {
		return nil
	}

	path := filepath.Join(migrationsPath, fileName)
	sqlBytes, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read migration %s: %w", fileName, err)
	}

	tx, err := db.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migration %s: %w", fileName, err)
	}

	if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
		_ = tx.Rollback(ctx)
		return fmt.Errorf("exec migration %s: %w", fileName, err)
	}

	if _, err := tx.Exec(ctx, `INSERT INTO _migrations (name) VALUES ($1)`, fileName); err != nil {
		_ = tx.Rollback(ctx)
		return fmt.Errorf("record migration %s: %w", fileName, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migration %s: %w", fileName, err)
	}

	log.Printf("Applied migration %s", fileName)
	return nil
}

func (db *DB) withTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(ctx, 10*time.Second)
}

type Wallet struct {
	ID             int64     `json:"id"`
	Address        string    `json:"address"`
	AssetClass     string    `json:"assetClass"`
	Label          *string   `json:"label,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	LatestPriceUSD *float64  `json:"latestPriceUsd,omitempty"`
	LatestAt       *time.Time `json:"latestAt,omitempty"`
}

func (db *DB) ListWallets(ctx context.Context) ([]Wallet, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	rows, err := db.Pool.Query(ctx, `
		SELECT w.id, w.address, w.asset_class, w.label, w.created_at,
		       p.price_usd, p.recorded_at
		FROM wallets w
		LEFT JOIN LATERAL (
			SELECT price_usd, recorded_at
			FROM price_history
			WHERE wallet_id = w.id
			ORDER BY recorded_at DESC
			LIMIT 1
		) p ON true
		ORDER BY w.id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var wallets []Wallet
	for rows.Next() {
		var wallet Wallet
		if err := rows.Scan(&wallet.ID, &wallet.Address, &wallet.AssetClass, &wallet.Label, &wallet.CreatedAt, &wallet.LatestPriceUSD, &wallet.LatestAt); err != nil {
			return nil, err
		}
		wallets = append(wallets, wallet)
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	return wallets, nil
}

func (db *DB) FindOrCreateWallet(ctx context.Context, address string, assetClass string, label *string) (Wallet, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	if assetClass == "" {
		assetClass = "crypto"
	}

	var wallet Wallet
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO wallets (address, asset_class, label)
		VALUES ($1, $2, $3)
		ON CONFLICT (address) DO UPDATE SET label = COALESCE(EXCLUDED.label, wallets.label)
		RETURNING id, address, asset_class, label, created_at
	`, address, assetClass, label).Scan(&wallet.ID, &wallet.Address, &wallet.AssetClass, &wallet.Label, &wallet.CreatedAt)

	if err != nil {
		return Wallet{}, err
	}
	return wallet, nil
}

func (db *DB) InsertPrice(ctx context.Context, walletID int64, priceUSD float64, recordedAt time.Time) error {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	_, err := db.Pool.Exec(ctx, `
		INSERT INTO price_history (wallet_id, price_usd, recorded_at)
		VALUES ($1, $2, $3)
	`, walletID, priceUSD, recordedAt)
	return err
}

type PricePoint struct {
	PriceUSD   float64   `json:"priceUsd"`
	RecordedAt time.Time `json:"recordedAt"`
}

func (db *DB) WalletHistory(ctx context.Context, walletID int64, from *time.Time, to *time.Time) ([]PricePoint, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	conditions := []string{"wallet_id = $1"}
	args := []interface{}{walletID}
	argIndex := 2

	if from != nil {
		conditions = append(conditions, fmt.Sprintf("recorded_at >= $%d", argIndex))
		args = append(args, *from)
		argIndex++
	}
	if to != nil {
		conditions = append(conditions, fmt.Sprintf("recorded_at <= $%d", argIndex))
		args = append(args, *to)
		argIndex++
	}

	query := fmt.Sprintf(`
		SELECT price_usd, recorded_at
		FROM price_history
		WHERE %s
		ORDER BY recorded_at ASC
	`, strings.Join(conditions, " AND "))

	rows, err := db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var points []PricePoint
	for rows.Next() {
		var point PricePoint
		if err := rows.Scan(&point.PriceUSD, &point.RecordedAt); err != nil {
			return nil, err
		}
		points = append(points, point)
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	return points, nil
}

func (db *DB) AggregateHistory(ctx context.Context, from *time.Time, to *time.Time) ([]PricePoint, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	conditions := []string{"1=1"}
	args := []interface{}{}
	argIndex := 1

	if from != nil {
		conditions = append(conditions, fmt.Sprintf("recorded_at >= $%d", argIndex))
		args = append(args, *from)
		argIndex++
	}
	if to != nil {
		conditions = append(conditions, fmt.Sprintf("recorded_at <= $%d", argIndex))
		args = append(args, *to)
		argIndex++
	}

	query := fmt.Sprintf(`
		SELECT recorded_at, SUM(price_usd) AS total_usd
		FROM price_history
		WHERE %s
		GROUP BY recorded_at
		ORDER BY recorded_at ASC
	`, strings.Join(conditions, " AND "))

	rows, err := db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var points []PricePoint
	for rows.Next() {
		var point PricePoint
		if err := rows.Scan(&point.RecordedAt, &point.PriceUSD); err != nil {
			return nil, err
		}
		points = append(points, point)
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	return points, nil
}

func (db *DB) FindWalletByAddress(ctx context.Context, address string) (Wallet, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	var wallet Wallet
	err := db.Pool.QueryRow(ctx, `
		SELECT id, address, asset_class, label, created_at
		FROM wallets
		WHERE address = $1
	`, address).Scan(&wallet.ID, &wallet.Address, &wallet.AssetClass, &wallet.Label, &wallet.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Wallet{}, pgx.ErrNoRows
		}
		return Wallet{}, err
	}
	return wallet, nil
}
