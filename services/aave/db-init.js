import pg from "pg";
const { Client } = pg;
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function initDb(connectionString, migrationsDir) {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    // Create migrations table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    if (fs.existsSync(migrationsDir)) {
      const migrations = fs.readdirSync(migrationsDir).sort();
      for (const file of migrations) {
        if (file.endsWith(".sql")) {
          const res = await client.query("SELECT id FROM _migrations WHERE name = $1", [file]);
          
          if (res.rowCount === 0) {
            const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
            await client.query("BEGIN");
            try {
              await client.query(sql);
              await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
              await client.query("COMMIT");
              console.log(`Applied migration: ${file}`);
            } catch (err) {
              await client.query("ROLLBACK");
              throw err;
            }
          }
        }
      }
    }
  } finally {
    await client.end();
  }
}
