import { logger } from "./logger.js";
import { getMarkets as getMarketsFromDb, setMarkets } from "./db.js";

const KAMINO_API = "https://api.kamino.finance";

export async function fetchMarkets() {
  logger.info("Fetching markets from Kamino API");
  
  const response = await fetch(`${KAMINO_API}/v2/kamino-market`);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch markets: ${response.status}`);
  }
  
  const markets = await response.json();
  setMarkets(markets);
  
  logger.info({ count: markets.length }, "Markets loaded and saved");
  return markets;
}

export function getCachedMarkets() {
  return getMarketsFromDb();
}

export async function getObligations(marketPubkey, walletAddress) {
  const url = `${KAMINO_API}/kamino-market/${marketPubkey}/users/${walletAddress}/obligations`;
  const response = await fetch(url);
  
  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`API Error: ${response.status}`);
  }
  
  return response.json();
}

function parseObligation(obl, marketName) {
  const stats = obl.refreshedStats;
  
  if (!stats || parseFloat(stats.userTotalBorrow) <= 0) {
    return null;
  }
  
  const ltv = parseFloat(stats.loanToValue) * 100;
  const liquidationLtv = parseFloat(stats.liquidationLtv) * 100;
  
  return {
    market: marketName,
    ltv: ltv.toFixed(2),
    liquidationLtv: liquidationLtv.toFixed(2),
    borrowed: parseFloat(stats.userTotalBorrow).toFixed(2),
    deposited: parseFloat(stats.userTotalDeposit).toFixed(2),
    netValue: parseFloat(stats.netAccountValue).toFixed(2),
    tag: obl.humanTag,
    healthFactor: Math.round(liquidationLtv / ltv * 100) / 100
  };
}

export async function scanAllMarketsForWallet(walletAddress, marketCheckCallback) {
  const markets = getCachedMarkets();
  
  if (!markets || markets.length === 0) {
    throw new Error("Markets not loaded");
  }
  
  const results = [];
  
  let index = 0;
  for (const market of markets) {
    try {
      const obligations = await getObligations(market.lendingMarket, walletAddress);
      
      for (const obl of obligations) {
        const pos = parseObligation(obl, market.name);
        if (pos) {
          results.push(pos);
        }
      }
    } catch (error) {
      logger.warn({ market: market.name, error: error.message }, "Failed to check market");
    }

    marketCheckCallback?.({current: index++, total: markets.length});
  }
  
  return results;
}

export async function checkSpecificMarkets(walletAddress, marketNames) {
  const allMarkets = getCachedMarkets();
  
  if (!allMarkets || allMarkets.length === 0) {
    throw new Error("Markets not loaded");
  }
  
  const marketsToCheck = allMarkets.filter(m => marketNames.includes(m.name));
  const results = [];

  logger.info({ walletAddress, marketNames }, `Markets to check size: ${marketsToCheck.length}`);
  
  for (const market of marketsToCheck) {
    try {
      const obligations = await getObligations(market.lendingMarket, walletAddress);
      
      logger.info({ walletAddress, market: market.name, obligations: obligations.length }, "Obligations");
      
      for (const obl of obligations) {
        const pos = parseObligation(obl, market.name);
        if (pos) {
          results.push(pos);
        }
      }
    } catch (error) {
      logger.warn({ market: market.name, error: error.message }, "Failed to check market");
    }
  }
  
  return results;
}