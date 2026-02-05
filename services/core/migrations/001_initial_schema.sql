CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  ui_state JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_identities (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  UNIQUE(provider, external_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kamino_settings (
  user_id INTEGER PRIMARY KEY,
  warning_hf DOUBLE PRECISION,
  danger_hf DOUBLE PRECISION,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS aave_settings (
  user_id INTEGER PRIMARY KEY,
  warning_hf DOUBLE PRECISION,
  danger_hf DOUBLE PRECISION,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS wallets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  address TEXT NOT NULL,
  protocol TEXT NOT NULL,
  UNIQUE(user_id, address, protocol),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
