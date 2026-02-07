import pg from "pg";
const { Client } = pg;
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { logger } from "./logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function connectWithRetry(connectionString, maxRetries = 10) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const client = new Client({ connectionString });
      await client.connect();
      logger.info("Database connection established successfully");
      return client;
    } catch (err) {
      const delay = Math.min(1000 * Math.pow(2, i), 30000);
      logger.warn({ attempt: i + 1, maxRetries, error: err.message }, "DB connection attempt failed");
      if (i < maxRetries - 1) {
        logger.info({ delay }, "Retrying...");
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw new Error(`Failed to connect after ${maxRetries} attempts: ${err.message}`);
      }
    }
  }
}

export async function initDb(connectionString, migrationsDir) {
  const client = await connectWithRetry(connectionString);

  try {
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
              logger.info({ migration: file }, "Applied migration");
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
