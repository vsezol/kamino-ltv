import { logger } from "./logger.js";

const required = ["STATS_SERVICE_URL"];

for (const key of required) {
  if (!process.env[key]) {
    logger.error(`${key} is not set`);
    process.exit(1);
  }
}

export const env = {
  STATS_SERVICE_URL: process.env.STATS_SERVICE_URL,
  BUDGETBAKERS_SERVICE_URL: process.env.BUDGETBAKERS_SERVICE_URL || "http://localhost:3005",
  SCRAPER_INTERVAL_SECONDS: parseNumber("SCRAPER_INTERVAL_SECONDS", 30),
  HEADLESS: (process.env.HEADLESS || "false").toLowerCase() === "true",
  PLAYWRIGHT_SLOWMO: parseNumber("PLAYWRIGHT_SLOWMO", 0),
  CAPTCHA_PROVIDER: process.env.CAPTCHA_PROVIDER || "",
  CAPTCHA_API_KEY: process.env.CAPTCHA_API_KEY || "",
  CAPTCHA_PROXY_TYPE: process.env.CAPTCHA_PROXY_TYPE || "",
  CAPTCHA_PROXY_ADDRESS: process.env.CAPTCHA_PROXY_ADDRESS || "",
  CAPTCHA_PROXY_PORT: parseOptionalNumber("CAPTCHA_PROXY_PORT"),
  CAPTCHA_PROXY_LOGIN: process.env.CAPTCHA_PROXY_LOGIN || "",
  CAPTCHA_PROXY_PASSWORD: process.env.CAPTCHA_PROXY_PASSWORD || "",
  CAPTCHA_USER_AGENT: process.env.CAPTCHA_USER_AGENT || "",
  JUPITER_API_KEY: process.env.JUPITER_API_KEY || "",
  NODE_ENV: process.env.NODE_ENV || "development"
};

function parseNumber(key, fallback) {
  const raw = process.env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  if (Number.isNaN(value)) {
    logger.error(`${key} must be a number`);
    process.exit(1);
  }
  return value;
}

function parseOptionalNumber(key) {
  const raw = process.env[key];
  if (!raw) return null;
  const value = Number(raw);
  if (Number.isNaN(value)) {
    logger.error(`${key} must be a number`);
    process.exit(1);
  }
  return value;
}
