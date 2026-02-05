import { logger } from "./logger.js";

const required = ["PORT", "DATABASE_URL"];

for (const key of required) {
  if (!process.env[key]) {
    logger.error(`${key} is not set`);
    process.exit(1);
  }
}

export const env = {
  PORT: process.env.PORT,
  DATABASE_URL: process.env.DATABASE_URL,
  NODE_ENV: process.env.NODE_ENV || "development"
};
