import { logger } from "../logger.js";

const KAMINO_API = "https://api.kamino.finance";
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
const COINGECKO_API = "https://api.coingecko.com/api/v3";

/**
 * Fetch with exponential backoff retry
 * @param {string} url - URL to fetch
 * @param {RequestInit} options - Fetch options
 * @param {number} retries - Number of retries (default: 3)
 * @returns {Promise<Response>} - Fetch response
 */
async function fetchWithRetry(url, options = {}, retries = 3) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      // For 4xx errors, don't retry (client error)
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`HTTP ${res.status}`);
      }
      // For 5xx errors, retry
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    
    if (attempt < retries - 1) {
      const delay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
      logger.debug({ url, attempt: attempt + 1, delay }, "Retrying fetch");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function getKaminoLendingValue(address) {
  const marketsRes = await fetchWithRetry(`${KAMINO_API}/v2/kamino-market`);
  const markets = await marketsRes.json();

  let total = 0;
  for (const market of markets) {
    try {
      const url = `${KAMINO_API}/kamino-market/${market.lendingMarket}/users/${address}/obligations`;
      const res = await fetchWithRetry(url, {}, 2); // Fewer retries for individual markets
      const obligations = await res.json();
      for (const obl of obligations) {
        const netValue = parseFloat(obl.refreshedStats?.netAccountValue || 0);
        if (netValue > 0) {
          total += netValue;
          logger.debug({ market: market.name, netValue }, "Kamino lending position");
        }
      }
    } catch (err) {
      // Log but continue with other markets
      logger.debug({ market: market.name, error: err.message }, "Failed to fetch market obligations");
    }
  }
  return total;
}

async function getKaminoVaultsValue(address) {
  const url = `${KAMINO_API}/kvaults/users/${address}/metrics/history?start=2020-01-01T00:00:00.000Z&end=2030-01-01T00:00:00.000Z`;
  
  try {
    const res = await fetchWithRetry(url);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      logger.debug({ address }, "No Kamino vault data found");
      return 0;
    }
    const latest = data[data.length - 1];
    const value = parseFloat(latest.usdAmount || 0);
    logger.debug({ address, value }, "Kamino vaults value");
    return value;
  } catch (err) {
    logger.error({ address, error: err.message }, "Failed to fetch Kamino vaults after retries");
    throw err; // Propagate error to prevent incomplete data
  }
}

async function getSolBalanceUsd(address) {
  const [balanceRes, priceRes] = await Promise.all([
    fetchWithRetry(SOLANA_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address]
      })
    }),
    fetchWithRetry(`${COINGECKO_API}/simple/price?ids=solana&vs_currencies=usd`)
  ]);

  const balanceData = await balanceRes.json();
  const priceData = await priceRes.json();

  const solBalance = (balanceData.result?.value || 0) / 1e9;
  const solPrice = priceData.solana?.usd || 0;

  logger.debug({ address, solBalance, solPrice }, "SOL balance and price");
  return solBalance * solPrice;
}

export async function scrapeSol(page, address) {
  // API-only implementation - page parameter is ignored
  const [lending, vaults, solValue] = await Promise.all([
    getKaminoLendingValue(address),
    getKaminoVaultsValue(address),
    getSolBalanceUsd(address)
  ]);

  const total = lending + vaults + solValue;

  logger.info(
    { address, lending: lending.toFixed(2), vaults: vaults.toFixed(2), solValue: solValue.toFixed(2), total: total.toFixed(2) },
    "Solana portfolio via API"
  );

  return total;
}
