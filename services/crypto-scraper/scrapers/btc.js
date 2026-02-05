import { parseUSD, sleep } from "./utils.js";

async function fetchBtcBalanceUsd(address) {
  const balanceRes = await fetch(`https://blockstream.info/api/address/${address}`);
  if (!balanceRes.ok) {
    throw new Error(`Blockstream balance fetch failed: ${balanceRes.status}`);
  }
  const data = await balanceRes.json();
  const funded =
    (data.chain_stats?.funded_txo_sum || 0) +
    (data.mempool_stats?.funded_txo_sum || 0);
  const spent =
    (data.chain_stats?.spent_txo_sum || 0) +
    (data.mempool_stats?.spent_txo_sum || 0);
  const sats = Math.max(funded - spent, 0);
  if (!sats) return 0;

  const priceRes = await fetch(
    "https://api.coinbase.com/v2/prices/BTC-USD/spot"
  );
  if (!priceRes.ok) {
    throw new Error(`Coinbase price fetch failed: ${priceRes.status}`);
  }
  const priceData = await priceRes.json();
  const price = Number.parseFloat(priceData?.data?.amount || "0");
  if (!price) return 0;
  return (sats / 1e8) * price;
}

export async function scrapeBtc(page, address) {
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);
  try {
    const apiBalance = await fetchBtcBalanceUsd(address);
    if (apiBalance) {
      return apiBalance;
    }
  } catch {
    // fall back to page scraping
  }
  await page.goto(`https://blockchair.com/bitcoin/address/${address}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000
  });

  await page.waitForSelector('.value-body, [class*="value"]', {
    timeout: 45000
  });

  const findMainBalance = async () => {
    return page.evaluate(() => {
      const elements = document.querySelectorAll("h2, h3, div, span");
      for (const el of elements) {
        if (el.textContent?.trim().toLowerCase() === "main balance") {
          const parent = el.parentElement;
          if (!parent) continue;
          const valueBody =
            parent.querySelector(".value-body") ||
            parent.querySelector('[class*="value-body"]');
          const valueText = valueBody?.innerText || parent.innerText || "";
          const match = valueText.match(/([\d,]+\.?\d*)\s*USD/i);
          if (match) return match[1];
        }
      }
      return null;
    });
  };

  let raw = await findMainBalance();
  if (!raw) {
    await sleep(3000);
    raw = await findMainBalance();
  }

  return raw ? parseUSD(raw) : 0;
}
