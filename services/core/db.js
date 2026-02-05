import pg from "pg";
const { Pool } = pg;
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./environment.js";
import { initDb } from "./db-init.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const connectionString = env.DATABASE_URL;
const migrationsDir = path.join(__dirname, "migrations");

const pool = new Pool({ connectionString });

// Initialize DB on module load
await initDb(connectionString, migrationsDir);

export default pool;

export async function findOrCreateUserByTelegramId(chatId) {
  const res = await pool.query("SELECT user_id FROM user_identities WHERE provider = 'telegram' AND external_id = $1", [String(chatId)]);
  
  if (res.rowCount > 0) {
    return res.rows[0].user_id;
  }

  const userRes = await pool.query("INSERT INTO users (ui_state) VALUES ('{}') RETURNING id");
  const userId = userRes.rows[0].id;
  
  await pool.query("INSERT INTO user_identities (user_id, provider, external_id) VALUES ($1, 'telegram', $2)", [userId, String(chatId)]);
  
  return userId;
}

export async function getUserData(userId) {
  const userRes = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  if (userRes.rowCount === 0) return null;
  const user = userRes.rows[0];

  const walletsRes = await pool.query("SELECT * FROM wallets WHERE user_id = $1", [userId]);
  const kaminoSettingsRes = await pool.query("SELECT * FROM kamino_settings WHERE user_id = $1", [userId]);
  const aaveSettingsRes = await pool.query("SELECT * FROM aave_settings WHERE user_id = $1", [userId]);

  const wallets = walletsRes.rows;
  const kaminoSettings = kaminoSettingsRes.rows[0];
  const aaveSettings = aaveSettingsRes.rows[0];

  const walletMap = {};
  wallets.forEach(w => {
    walletMap[w.address] = { protocol: w.protocol };
  });

  return {
    id: user.id,
    wallets: walletMap,
    settings: {
      kamino: {
        warningHealthFactor: kaminoSettings?.warning_hf,
        dangerHealthFactor: kaminoSettings?.danger_hf
      },
      aave: {
        warningHealthFactor: aaveSettings?.warning_hf,
        dangerHealthFactor: aaveSettings?.danger_hf
      }
    }
  };
}

export async function saveUserData(userId, data) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (data.settings?.kamino) {
      const s = data.settings.kamino;
      await client.query(`
        INSERT INTO kamino_settings (user_id, warning_hf, danger_hf) 
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET 
          warning_hf = EXCLUDED.warning_hf, 
          danger_hf = EXCLUDED.danger_hf
      `, [userId, s.warningHealthFactor, s.dangerHealthFactor]);
    }

    if (data.settings?.aave) {
      const s = data.settings.aave;
      await client.query(`
        INSERT INTO aave_settings (user_id, warning_hf, danger_hf) 
        VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET 
          warning_hf = EXCLUDED.warning_hf, 
          danger_hf = EXCLUDED.danger_hf
      `, [userId, s.warningHealthFactor, s.dangerHealthFactor]);
    }

    if (data.wallets) {
      for (const [address, wData] of Object.entries(data.wallets)) {
        await client.query(`
          INSERT INTO wallets (user_id, address, protocol) 
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id, address, protocol) DO NOTHING
        `, [userId, address, wData.protocol]);
      }
      
      const addresses = Object.keys(data.wallets);
      if (addresses.length > 0) {
        await client.query("DELETE FROM wallets WHERE user_id = $1 AND address != ALL($2)", [userId, addresses]);
      } else {
        await client.query("DELETE FROM wallets WHERE user_id = $1", [userId]);
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteUser(userId) {
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

export async function getAllUserIds() {
  const res = await pool.query("SELECT id FROM users");
  return res.rows.map(r => r.id);
}
