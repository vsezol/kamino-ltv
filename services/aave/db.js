import pg from "pg";
const { Pool } = pg;
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./environment.js";
import { initDb } from "./db-init.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const connectionString = env.DATABASE_URL;
const migrationsDir = path.join(__dirname, "migrations");

if (!connectionString) {
  throw new Error("DATABASE_URL not set");
}

const pool = new Pool({ connectionString });

// Initialize DB on module load
await initDb(connectionString, migrationsDir);

export default pool;

export async function getAaveMarkets(network) {
  const res = await pool.query("SELECT data FROM aave_markets WHERE network = $1", [network]);
  return res.rowCount > 0 ? res.rows[0].data : [];
}

export async function setAaveMarkets(network, markets) {
  await pool.query(`
    INSERT INTO aave_markets (network, data, updated_at) 
    VALUES ($1, $2, CURRENT_TIMESTAMP)
    ON CONFLICT (network) DO UPDATE SET 
      data = EXCLUDED.data, 
      updated_at = CURRENT_TIMESTAMP
  `, [network, JSON.stringify(markets)]);
}
