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

type Credentials struct {
	ID         int64     `json:"id"`
	Email      string    `json:"email"`
	UserID     string    `json:"userId"`
	CouchURL   string    `json:"couchUrl"`
	CouchDB    string    `json:"couchDb"`
	CouchLogin string    `json:"couchLogin"`
	CouchToken string    `json:"-"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type Account struct {
	ID           int64      `json:"id"`
	CredentialID int64      `json:"credentialId"`
	AccountID    string     `json:"accountId"`
	Name         string     `json:"name"`
	CurrencyCode *string    `json:"currencyCode,omitempty"`
	BalanceCents int64      `json:"balanceCents"`
	Excluded     bool       `json:"excluded"`
	Archived     bool       `json:"archived"`
	LastSync     *time.Time `json:"lastSync,omitempty"`
}

func (db *DB) SaveCredentials(ctx context.Context, email, userID, couchURL, couchDB, couchLogin, couchToken string) (*Credentials, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	var creds Credentials
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO credentials (email, user_id, couch_url, couch_db, couch_login, couch_token)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (email) DO UPDATE SET
			user_id = EXCLUDED.user_id,
			couch_url = EXCLUDED.couch_url,
			couch_db = EXCLUDED.couch_db,
			couch_login = EXCLUDED.couch_login,
			couch_token = EXCLUDED.couch_token,
			updated_at = NOW()
		RETURNING id, email, user_id, couch_url, couch_db, couch_login, couch_token, created_at, updated_at
	`, email, userID, couchURL, couchDB, couchLogin, couchToken).Scan(
		&creds.ID, &creds.Email, &creds.UserID, &creds.CouchURL, &creds.CouchDB,
		&creds.CouchLogin, &creds.CouchToken, &creds.CreatedAt, &creds.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &creds, nil
}

func (db *DB) GetCredentials(ctx context.Context) (*Credentials, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	var creds Credentials
	err := db.Pool.QueryRow(ctx, `
		SELECT id, email, user_id, couch_url, couch_db, couch_login, couch_token, created_at, updated_at
		FROM credentials
		ORDER BY id DESC
		LIMIT 1
	`).Scan(
		&creds.ID, &creds.Email, &creds.UserID, &creds.CouchURL, &creds.CouchDB,
		&creds.CouchLogin, &creds.CouchToken, &creds.CreatedAt, &creds.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &creds, nil
}

func (db *DB) DeleteCredentials(ctx context.Context, id int64) error {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	_, err := db.Pool.Exec(ctx, `DELETE FROM credentials WHERE id = $1`, id)
	return err
}

func (db *DB) UpsertAccount(ctx context.Context, credID int64, accountID, name string, currencyCode *string, balanceCents int64, excluded, archived bool) (*Account, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	var acc Account
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO accounts (credential_id, account_id, name, currency_code, balance_cents, excluded, archived, last_sync)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (credential_id, account_id) DO UPDATE SET
			name = EXCLUDED.name,
			currency_code = EXCLUDED.currency_code,
			balance_cents = EXCLUDED.balance_cents,
			archived = EXCLUDED.archived,
			last_sync = NOW()
		RETURNING id, credential_id, account_id, name, currency_code, balance_cents, excluded, archived, last_sync
	`, credID, accountID, name, currencyCode, balanceCents, excluded, archived).Scan(
		&acc.ID, &acc.CredentialID, &acc.AccountID, &acc.Name, &acc.CurrencyCode,
		&acc.BalanceCents, &acc.Excluded, &acc.Archived, &acc.LastSync,
	)
	if err != nil {
		return nil, err
	}
	return &acc, nil
}

func (db *DB) ListAccounts(ctx context.Context, credID int64) ([]Account, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	rows, err := db.Pool.Query(ctx, `
		SELECT id, credential_id, account_id, name, currency_code, balance_cents, excluded, archived, last_sync
		FROM accounts
		WHERE credential_id = $1
		ORDER BY name ASC
	`, credID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accounts []Account
	for rows.Next() {
		var acc Account
		if err := rows.Scan(&acc.ID, &acc.CredentialID, &acc.AccountID, &acc.Name, &acc.CurrencyCode,
			&acc.BalanceCents, &acc.Excluded, &acc.Archived, &acc.LastSync); err != nil {
			return nil, err
		}
		accounts = append(accounts, acc)
	}
	return accounts, rows.Err()
}

func (db *DB) UpdateAccountExcluded(ctx context.Context, id int64, excluded bool) error {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	_, err := db.Pool.Exec(ctx, `
		UPDATE accounts SET excluded = $2 WHERE id = $1
	`, id, excluded)
	return err
}

func (db *DB) GetTotalBalanceUSD(ctx context.Context, credID int64) (float64, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	var total float64
	err := db.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(
			CASE 
				WHEN currency_code = 'USD' THEN balance_cents::float / 100
				WHEN currency_code = 'EUR' THEN balance_cents::float / 100 * 1.08
				WHEN currency_code = 'RUB' THEN balance_cents::float / 100 / 95
				WHEN currency_code = 'GEL' THEN balance_cents::float / 100 / 2.7
				WHEN currency_code = 'KZT' THEN balance_cents::float / 100 / 450
				WHEN currency_code = 'TRY' THEN balance_cents::float / 100 / 35
				ELSE balance_cents::float / 100
			END
		), 0)
		FROM accounts
		WHERE credential_id = $1 AND excluded = FALSE AND archived = FALSE
	`, credID).Scan(&total)
	return total, err
}

type BalanceHistoryPoint struct {
	BalanceCents int64     `json:"balanceCents"`
	BalanceUSD   *float64  `json:"balanceUsd,omitempty"`
	RecordedAt   time.Time `json:"recordedAt"`
}

func (db *DB) InsertBalanceHistory(ctx context.Context, accountID int64, balanceCents int64, balanceUSD *float64) error {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	_, err := db.Pool.Exec(ctx, `
		INSERT INTO balance_history (account_id, balance_cents, balance_usd)
		VALUES ($1, $2, $3)
	`, accountID, balanceCents, balanceUSD)
	return err
}

func (db *DB) GetAccountHistory(ctx context.Context, accountID int64, from, to *time.Time) ([]BalanceHistoryPoint, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	query := `
		SELECT balance_cents, balance_usd, recorded_at
		FROM balance_history
		WHERE account_id = $1
	`
	args := []interface{}{accountID}

	if from != nil {
		query += " AND recorded_at >= $2"
		args = append(args, *from)
	}
	if to != nil {
		if from != nil {
			query += " AND recorded_at <= $3"
		} else {
			query += " AND recorded_at <= $2"
		}
		args = append(args, *to)
	}

	query += " ORDER BY recorded_at ASC"

	rows, err := db.Pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var points []BalanceHistoryPoint
	for rows.Next() {
		var p BalanceHistoryPoint
		if err := rows.Scan(&p.BalanceCents, &p.BalanceUSD, &p.RecordedAt); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, rows.Err()
}

func (db *DB) GetAccountByID(ctx context.Context, id int64) (*Account, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	var acc Account
	err := db.Pool.QueryRow(ctx, `
		SELECT id, credential_id, account_id, name, currency_code, balance_cents, excluded, archived, last_sync
		FROM accounts
		WHERE id = $1
	`, id).Scan(
		&acc.ID, &acc.CredentialID, &acc.AccountID, &acc.Name, &acc.CurrencyCode,
		&acc.BalanceCents, &acc.Excluded, &acc.Archived, &acc.LastSync,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &acc, nil
}
