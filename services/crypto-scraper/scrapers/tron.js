import { parseUSD, sleep } from "./utils.js";

export async function scrapeTron(page, address) {
  await page.goto(`https://tronscan.org/#/address/${address}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000
  });

  await page.waitForSelector(".token-balance-item", { timeout: 20000 });
  await sleep(3000);

  const findBalances = async () => {
    return page.evaluate(() => {
      const tokenItems = document.querySelectorAll(".token-balance-item");
      let trxUsd = 0;
      let trxAmount = 0;
      let temAmount = 0;

      for (const item of tokenItems) {
        const nameEl = item.querySelector(".token-name");
        const name = nameEl?.innerText?.toLowerCase() || "";
        const numText = item.querySelector(".token-num")?.innerText || "";
        const amount = parseFloat(numText.replace(/,/g, "")) || 0;
        const valueText = item.querySelector(".token-value")?.innerText || "";

        if (name.includes("trx") && name.includes("tron")) {
          const match = valueText.match(/\$([\d,]+(?:\.\d+)?)/);
          if (match) trxUsd = Number(match[1].replace(/,/g, ""));
          trxAmount = amount;
        } else if (name.includes("tem") && name.includes("tronenergymarket")) {
          temAmount = amount;
        }
      }

      let temUsd = 0;
      if (temAmount > 0 && trxAmount > 0 && trxUsd > 0) {
        const trxPrice = trxUsd / trxAmount;
        temUsd = temAmount * trxPrice;
      }

      return trxUsd + temUsd;
    });
  };

  let balance = await findBalances();
  if (!balance) {
    await sleep(3000);
    balance = await findBalances();
  }

  return balance ? parseUSD(balance.toString()) : 0;
}
