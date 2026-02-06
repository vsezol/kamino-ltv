CREATE TABLE IF NOT EXISTS credentials (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  user_id VARCHAR(255) NOT NULL,
  couch_url VARCHAR(255) NOT NULL,
  couch_db VARCHAR(255) NOT NULL,
  couch_login VARCHAR(255) NOT NULL,
  couch_token TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  credential_id INTEGER NOT NULL REFERENCES credentials(id) ON DELETE CASCADE,
  account_id VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  currency_code VARCHAR(10),
  balance_cents BIGINT DEFAULT 0,
  excluded BOOLEAN DEFAULT FALSE,
  archived BOOLEAN DEFAULT FALSE,
  last_sync TIMESTAMPTZ,
  UNIQUE(credential_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_accounts_credential ON accounts(credential_id);
