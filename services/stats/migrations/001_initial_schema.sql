CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  address TEXT NOT NULL UNIQUE,
  asset_class TEXT NOT NULL DEFAULT 'crypto',
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  price_usd DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_wallet_time
  ON price_history (wallet_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_history_recorded_at
  ON price_history (recorded_at DESC);
