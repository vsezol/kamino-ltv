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

export async function getMarkets() {
  const res = await pool.query("SELECT data FROM kamino_markets WHERE id = 1");
  return res.rowCount > 0 ? res.rows[0].data : [];
}

export async function setMarkets(markets) {
  await pool.query(`
    INSERT INTO kamino_markets (id, data, updated_at) 
    VALUES (1, $1, CURRENT_TIMESTAMP)
    ON CONFLICT (id) DO UPDATE SET 
      data = EXCLUDED.data, 
      updated_at = CURRENT_TIMESTAMP
  `, [JSON.stringify(markets)]);
}
