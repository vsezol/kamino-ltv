CREATE TABLE IF NOT EXISTS balance_history (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    balance_cents BIGINT NOT NULL,
    balance_usd DECIMAL(20, 2),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_history_account_time ON balance_history(account_id, recorded_at DESC);
