import { logger } from "./logger.js";

const required = ["BOT_TOKEN", "CORE_SERVICE_URL"];

for (const key of required) {
  if (!process.env[key]) {
    logger.error(`${key} is not set`);
    process.exit(1);
  }
}

export const env = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  CORE_SERVICE_URL: process.env.CORE_SERVICE_URL,
  NODE_ENV: process.env.NODE_ENV || "development"
};
