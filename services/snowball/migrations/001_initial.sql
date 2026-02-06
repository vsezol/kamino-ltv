CREATE TABLE IF NOT EXISTS credentials (
    id SERIAL PRIMARY KEY,
    cookie_header TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolios (
    id SERIAL PRIMARY KEY,
    credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
    portfolio_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    currency VARCHAR(10),
    is_composite BOOLEAN DEFAULT FALSE,
    current_cost_usd DECIMAL(20, 2) DEFAULT 0,
    income_percent DECIMAL(10, 4) DEFAULT 0,
    excluded BOOLEAN DEFAULT FALSE,
    last_sync TIMESTAMPTZ,
    UNIQUE(credential_id, portfolio_id)
);

CREATE TABLE IF NOT EXISTS balance_history (
    id SERIAL PRIMARY KEY,
    portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
    balance_usd DECIMAL(20, 2) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolios_credential ON portfolios(credential_id);
CREATE INDEX IF NOT EXISTS idx_balance_history_portfolio_time ON balance_history(portfolio_id, recorded_at DESC);
