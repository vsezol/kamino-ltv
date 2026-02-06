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
	ID               int64      `json:"id"`
	Email            *string    `json:"email,omitempty"`
	Password         *string    `json:"-"`
	CookieHeader     *string    `json:"-"`
	CookiesJSON      *string    `json:"-"`
	CookiesExpiresAt *time.Time `json:"cookiesExpiresAt,omitempty"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

type Portfolio struct {
	ID             int64      `json:"id"`
	CredentialID   int64      `json:"credentialId"`
	PortfolioID    string     `json:"portfolioId"`
	Name           string     `json:"name"`
	Currency       *string    `json:"currency,omitempty"`
	IsComposite    bool       `json:"isComposite"`
	CurrentCostUSD float64    `json:"currentCostUsd"`
	IncomePercent  float64    `json:"incomePercent"`
	Excluded       bool       `json:"excluded"`
	LastSync       *time.Time `json:"lastSync,omitempty"`
}

type BalanceHistoryPoint struct {
	BalanceUSD float64   `json:"balanceUsd"`
	RecordedAt time.Time `json:"recordedAt"`
}

func (db *DB) SaveCredentials(ctx context.Context, email, password string) (*Credentials, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	_, err := db.Pool.Exec(ctx, `DELETE FROM credentials`)
	if err != nil {
		return nil, fmt.Errorf("failed to clear credentials: %w", err)
	}

	var creds Credentials
	err = db.Pool.QueryRow(ctx, `
		INSERT INTO credentials (email, password)
		VALUES ($1, $2)
		RETURNING id, email, password, cookie_header, cookies_json, cookies_expires_at, created_at, updated_at
	`, email, password).Scan(
		&creds.ID, &creds.Email, &creds.Password, &creds.CookieHeader,
		&creds.CookiesJSON, &creds.CookiesExpiresAt, &creds.CreatedAt, &creds.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return &creds, nil
}

func (db *DB) UpdateCookies(ctx context.Context, id int64, cookieHeader string, expiresAt time.Time) error {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	_, err := db.Pool.Exec(ctx, `
		UPDATE credentials 
		SET cookie_header = $2, cookies_expires_at = $3, updated_at = NOW()
		WHERE id = $1
	`, id, cookieHeader, expiresAt)
	return err
}

func (db *DB) GetCredentials(ctx context.Context) (*Credentials, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	var creds Credentials
	err := db.Pool.QueryRow(ctx, `
		SELECT id, email, password, cookie_header, cookies_json, cookies_expires_at, created_at, updated_at
		FROM credentials
		ORDER BY id DESC
		LIMIT 1
	`).Scan(
		&creds.ID, &creds.Email, &creds.Password, &creds.CookieHeader,
		&creds.CookiesJSON, &creds.CookiesExpiresAt, &creds.CreatedAt, &creds.UpdatedAt,
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

func (db *DB) UpsertPortfolio(ctx context.Context, credID int64, portfolioID, name string, currency *string, isComposite bool, currentCostUSD, incomePercent float64) (*Portfolio, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	var p Portfolio
	err := db.Pool.QueryRow(ctx, `
		INSERT INTO portfolios (credential_id, portfolio_id, name, currency, is_composite, current_cost_usd, income_percent, last_sync)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (credential_id, portfolio_id) DO UPDATE SET
			name = EXCLUDED.name,
			currency = EXCLUDED.currency,
			is_composite = EXCLUDED.is_composite,
			current_cost_usd = EXCLUDED.current_cost_usd,
			income_percent = EXCLUDED.income_percent,
			last_sync = NOW()
		RETURNING id, credential_id, portfolio_id, name, currency, is_composite, current_cost_usd, income_percent, excluded, last_sync
	`, credID, portfolioID, name, currency, isComposite, currentCostUSD, incomePercent).Scan(
		&p.ID, &p.CredentialID, &p.PortfolioID, &p.Name, &p.Currency,
		&p.IsComposite, &p.CurrentCostUSD, &p.IncomePercent, &p.Excluded, &p.LastSync,
	)
	if err != nil {
		return nil, err
	}
	return &p, nil
}

func (db *DB) ListPortfolios(ctx context.Context, credID int64) ([]Portfolio, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	rows, err := db.Pool.Query(ctx, `
		SELECT id, credential_id, portfolio_id, name, currency, is_composite, current_cost_usd, income_percent, excluded, last_sync
		FROM portfolios
		WHERE credential_id = $1
		ORDER BY name ASC
	`, credID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var portfolios []Portfolio
	for rows.Next() {
		var p Portfolio
		if err := rows.Scan(&p.ID, &p.CredentialID, &p.PortfolioID, &p.Name, &p.Currency,
			&p.IsComposite, &p.CurrentCostUSD, &p.IncomePercent, &p.Excluded, &p.LastSync); err != nil {
			return nil, err
		}
		portfolios = append(portfolios, p)
	}
	return portfolios, rows.Err()
}

func (db *DB) UpdatePortfolioExcluded(ctx context.Context, id int64, excluded bool) error {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	_, err := db.Pool.Exec(ctx, `
		UPDATE portfolios SET excluded = $2 WHERE id = $1
	`, id, excluded)
	return err
}

func (db *DB) GetTotalBalanceUSD(ctx context.Context, credID int64) (float64, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	var total float64
	err := db.Pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(current_cost_usd), 0)
		FROM portfolios
		WHERE credential_id = $1 AND excluded = FALSE AND is_composite = FALSE
	`, credID).Scan(&total)
	return total, err
}

func (db *DB) InsertBalanceHistory(ctx context.Context, portfolioID int64, balanceUSD float64) error {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	_, err := db.Pool.Exec(ctx, `
		INSERT INTO balance_history (portfolio_id, balance_usd)
		VALUES ($1, $2)
	`, portfolioID, balanceUSD)
	return err
}

func (db *DB) GetPortfolioHistory(ctx context.Context, portfolioID int64, from, to *time.Time) ([]BalanceHistoryPoint, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	query := `
		SELECT balance_usd, recorded_at
		FROM balance_history
		WHERE portfolio_id = $1
	`
	args := []interface{}{portfolioID}

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
		if err := rows.Scan(&p.BalanceUSD, &p.RecordedAt); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, rows.Err()
}

func (db *DB) GetPortfolioByID(ctx context.Context, id int64) (*Portfolio, error) {
	ctx, cancel := db.withTimeout(ctx)
	defer cancel()

	var p Portfolio
	err := db.Pool.QueryRow(ctx, `
		SELECT id, credential_id, portfolio_id, name, currency, is_composite, current_cost_usd, income_percent, excluded, last_sync
		FROM portfolios
		WHERE id = $1
	`, id).Scan(
		&p.ID, &p.CredentialID, &p.PortfolioID, &p.Name, &p.Currency,
		&p.IsComposite, &p.CurrentCostUSD, &p.IncomePercent, &p.Excluded, &p.LastSync,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &p, nil
}
