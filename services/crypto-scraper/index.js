import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { env } from "./environment.js";
import { logger } from "./logger.js";
import { detectWalletType, normalizeAddress } from "./scrapers/utils.js";
import { scrapeEvm } from "./scrapers/evm.js";
import { scrapeSol } from "./scrapers/sol.js";
import { scrapeBtc } from "./scrapers/btc.js";
import { scrapeTron } from "./scrapers/tron.js";
import { maybeSolveCaptcha } from "./captcha.js";

chromium.use(StealthPlugin());

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function buildPlaywrightProxy(envConfig) {
  if (
    !envConfig.CAPTCHA_PROXY_TYPE ||
    !envConfig.CAPTCHA_PROXY_ADDRESS ||
    !envConfig.CAPTCHA_PROXY_PORT
  ) {
    return null;
  }

  const proxy = {
    server: `${envConfig.CAPTCHA_PROXY_TYPE}://${envConfig.CAPTCHA_PROXY_ADDRESS}:${envConfig.CAPTCHA_PROXY_PORT}`
  };
  if (envConfig.CAPTCHA_PROXY_LOGIN) {
    proxy.username = envConfig.CAPTCHA_PROXY_LOGIN;
  }
  if (envConfig.CAPTCHA_PROXY_PASSWORD) {
    proxy.password = envConfig.CAPTCHA_PROXY_PASSWORD;
  }
  return proxy;
}

async function fetchWallets() {
  const res = await fetch(`${env.STATS_SERVICE_URL}/api/wallets`);
  if (!res.ok) {
    throw new Error(`Failed to fetch wallets: ${res.status}`);
  }
  const payload = await res.json();
  return payload.wallets || [];
}

async function postPrice(walletId, priceUsd) {
  const res = await fetch(`${env.STATS_SERVICE_URL}/api/prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletId,
      priceUsd,
      recordedAt: new Date().toISOString()
    })
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || "Failed to post price");
  }
}

async function getOrCreatePage(context, pageCache, cacheKey) {
  const cached = pageCache.get(cacheKey);
  if (cached && !cached.isClosed()) {
    return cached;
  }
  const page = await context.newPage();
  pageCache.set(cacheKey, page);
  return page;
}

async function scrapeWallet(context, wallet, pageCache) {
  const address = normalizeAddress(wallet.address);
  const walletType = detectWalletType(address);

  // Solana uses API-only, no browser needed
  if (walletType === "sol") {
    try {
      const value = await scrapeSol(null, address);
      if (value && !Number.isNaN(value)) {
        await postPrice(wallet.id, value);
        logger.info(`Saved ${address} balance: ${value}`);
      } else {
        logger.warn(`No balance for ${address}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : "No stack";
      logger.info(`SCRAPE_ERROR ${address}: ${msg}`);
      logger.info(`STACK: ${stack}`);
    }
    return;
  }

  // Other wallet types need browser
  let page;
  try {
    page = await getOrCreatePage(context, pageCache, wallet.id);
  } catch (err) {
    console.log("CONTEXT_NEW_PAGE_ERROR", err.message);
    throw err;
  }
  const solveCaptcha = () => maybeSolveCaptcha(page, env);

  try {
    let value = 0;
    if (walletType === "evm") {
      value = await scrapeEvm(page, address);
    } else if (walletType === "btc") {
      value = await scrapeBtc(page, address);
    } else if (walletType === "tron") {
      value = await scrapeTron(page, address);
    } else {
      logger.warn("Unsupported wallet type for %s", address);
      await page.close();
      return;
    }

    if (!value || Number.isNaN(value)) {
      const solved = await solveCaptcha();
      if (solved) {
        await page.waitForTimeout(3000);
        if (walletType === "evm") value = await scrapeEvm(page, address);
        if (walletType === "btc") value = await scrapeBtc(page, address);
        if (walletType === "tron") value = await scrapeTron(page, address);
      }
    }

    if (value && !Number.isNaN(value)) {
      await postPrice(wallet.id, value);
      logger.info(`Saved ${address} balance: ${value}`);
    } else {
      logger.warn(`No balance for ${address}`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : "No stack";
    logger.info(`SCRAPE_ERROR ${address}: ${msg}`);
    logger.info(`STACK: ${stack}`);
  }
}

async function run() {
  const proxy = buildPlaywrightProxy(env);
  const browser = await chromium.launch({
    headless: env.HEADLESS,
    slowMo: env.PLAYWRIGHT_SLOWMO,
    proxy: proxy || undefined
  });

  const userAgent = env.CAPTCHA_USER_AGENT || USER_AGENT;
  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1440, height: 900 },
    locale: "en-US"
  });

  let isRunning = false;
  const pageCache = new Map();

    const cycle = async () => {
      if (isRunning) return;
      isRunning = true;
      try {
        const wallets = await fetchWallets();
        logger.info(`Scraping ${wallets.length} wallets`);
        for (const wallet of wallets) {
          try {
            await scrapeWallet(context, wallet, pageCache);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const stack = err instanceof Error ? err.stack : "No stack";
            logger.info(`WALLET_ERROR ${wallet.address}: ${msg}`);
            logger.info(`STACK: ${stack}`);
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : "No stack";
        logger.info(`CYCLE_ERROR: ${msg}`);
        logger.info(`STACK: ${stack}`);
      } finally {
        isRunning = false;
      }
    };

  await cycle();
  setInterval(cycle, env.SCRAPER_INTERVAL_SECONDS * 1000);

  process.on("SIGINT", async () => {
    await browser.close();
    process.exit(0);
  });
}

run().catch((error) => {
  logger.error(
    { error, message: error?.message, stack: error?.stack },
    "Scraper failed to start"
  );
  process.exit(1);
});
