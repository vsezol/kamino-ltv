import { parseUSD, sleep } from "./utils.js";

export async function scrapeEvm(page, address) {
  await page.goto(`https://debank.com/profile/${address}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  const selector = '[class*="HeaderInfo_totalAssetInner"]';
  await page.waitForSelector(selector, { timeout: 20000 });

  const readBalance = async () => {
    const text = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el?.innerText || "";
    }, selector);
    const match = text.match(/\$([\d,]+(?:\.\d+)?)/);
    return match ? parseUSD(match[1]) : 0;
  };

  let balance = 0;
  let lastBalance = -1;
  let stableCount = 0;

  for (let i = 0; i < 20; i += 1) {
    await sleep(500);
    balance = await readBalance();
    if (balance > 0 && balance === lastBalance) {
      stableCount += 1;
      if (stableCount >= 5) break;
    } else {
      stableCount = 0;
    }
    lastBalance = balance;
  }

  return balance;
}
