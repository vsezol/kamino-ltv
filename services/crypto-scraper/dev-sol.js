import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { maybeSolveCaptcha, solveTurnstileToken } from "./captcha.js";
import { logger } from "./logger.js";
import { scrapeSol } from "./scrapers/sol.js";

chromium.use(StealthPlugin());

const DEFAULT_ADDRESS = "EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function buildProxyFromEnv(env) {
  if (!env.CAPTCHA_PROXY_TYPE || !env.CAPTCHA_PROXY_ADDRESS || !env.CAPTCHA_PROXY_PORT) {
    return null;
  }
  const proxy = {
    server: `${env.CAPTCHA_PROXY_TYPE}://${env.CAPTCHA_PROXY_ADDRESS}:${env.CAPTCHA_PROXY_PORT}`
  };
  if (env.CAPTCHA_PROXY_LOGIN) {
    proxy.username = env.CAPTCHA_PROXY_LOGIN;
  }
  if (env.CAPTCHA_PROXY_PASSWORD) {
    proxy.password = env.CAPTCHA_PROXY_PASSWORD;
  }
  return proxy;
}

function buildCaptchaEnv() {
  return {
    CAPTCHA_PROVIDER: process.env.CAPTCHA_PROVIDER || "2captcha",
    CAPTCHA_API_KEY: process.env.CAPTCHA_API_KEY || "",
    CAPTCHA_PROXY_TYPE: process.env.CAPTCHA_PROXY_TYPE || "",
    CAPTCHA_PROXY_ADDRESS: process.env.CAPTCHA_PROXY_ADDRESS || "",
    CAPTCHA_PROXY_PORT: process.env.CAPTCHA_PROXY_PORT
      ? Number(process.env.CAPTCHA_PROXY_PORT)
      : null,
    CAPTCHA_PROXY_LOGIN: process.env.CAPTCHA_PROXY_LOGIN || "",
    CAPTCHA_PROXY_PASSWORD: process.env.CAPTCHA_PROXY_PASSWORD || "",
    CAPTCHA_USER_AGENT: process.env.CAPTCHA_USER_AGENT || ""
  };
}

async function run() {
  const address = process.env.SOL_DEV_ADDRESS || DEFAULT_ADDRESS;
  const headless = (process.env.HEADLESS || "false").toLowerCase() === "true";
  const slowMo = Number(process.env.PLAYWRIGHT_SLOWMO || 0);
  const keepOpen = (process.env.SOL_DEV_KEEP_OPEN || "false").toLowerCase() === "true";
  const extraWaitMs = Number(process.env.SOL_DEV_WAIT_MS || 30000);
  const env = buildCaptchaEnv();
  const proxy = buildProxyFromEnv(env);
  const userAgent = env.CAPTCHA_USER_AGENT || USER_AGENT;

  const browser = await chromium.launch({
    headless,
    slowMo,
    proxy: proxy || undefined
  });

  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1440, height: 900 },
    locale: "en-US"
  });

  const page = await context.newPage();
  const solveCaptcha = () => maybeSolveCaptcha(page, env);
  const getTurnstileToken = (payload) => solveTurnstileToken(env, payload);

  const value = await scrapeSol(page, address, {
    solveCaptcha,
    getTurnstileToken,
    debug: true
  });

  logger.info("SOL portfolio for %s: %s", address, value);

  if (extraWaitMs > 0) {
    logger.info("Waiting %dms for manual inspection", extraWaitMs);
    await page.waitForTimeout(extraWaitMs);
  }
  if (keepOpen) {
    logger.info("Keeping browser open for manual inspection");
    await new Promise(() => {});
  }
  await browser.close();
}

run().catch((error) => {
  logger.error(
    { error, message: error?.message, stack: error?.stack },
    "SOL dev scraper failed"
  );
  process.exit(1);
});
