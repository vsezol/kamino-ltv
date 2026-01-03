import { Telegraf } from "telegraf";
import { fetchMarkets, scanAllMarketsForWallet, checkSpecificMarkets } from "./kamino.js";
import { loadDb, getUser, setUser, deleteUser, getUserCount, getAllUsers } from "./db.js";
import { logger } from "./logger.js";

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  logger.error("BOT_TOKEN not set");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

const CHECK_INTERVAL = 10 * 60 * 1000;
const WARNING_HEALTH_FACTOR = 1.5;
const DANGER_HEALTH_FACTOR = 1.3;

loadDb();

async function deleteMessage(ctx, messageId) {
  try {
    await ctx.deleteMessage(messageId);
  } catch {
    // ignore if message already deleted
  }
}

bot.start((ctx) => {
  ctx.reply(
    "LTV Watch Bot\n\n" +
    "/add <wallet> - add wallet to monitor\n" +
    "/remove <wallet> - remove wallet\n" +
    "/list - show your wallets\n" +
    "/check - check LTV for your wallets\n" +
    "/refreshmarkets - rescan markets for your wallets\n" +
    "/stop - stop monitoring and remove all wallets"
  );
});

bot.command("add", async (ctx) => {
  const wallet = ctx.message.text.split(" ")[1];
  
  if (!wallet || wallet.length < 32) {
    return ctx.reply("Usage: /add <wallet_address>");
  }
  
  const chatId = String(ctx.chat.id);
  const statusMsg = await ctx.reply("Scanning all markets...");
  
  try {
    const positions = await scanAllMarketsForWallet(wallet);
    
    await deleteMessage(ctx, statusMsg.message_id);
    
    if (!positions || positions.length === 0) {
      return ctx.reply("No positions found for this wallet");
    }
    
    let user = getUser(chatId);
    if (!user) {
      user = { wallets: {} };
    }
    
    const marketNames = positions.map(p => p.market);
    
    user.wallets[wallet] = {
      markets: marketNames,
    };
    
    setUser(chatId, user);
    
    logger.info({ chatId, wallet, markets: marketNames }, "Wallet added");
    
    const lines = positions.map(p => `${p.market}: ${p.ltv}% (liq: ${p.liquidationLtv}%) (hf: ${p.healthFactor})`);
    ctx.reply(`Wallet added\n\n\`${wallet}\`\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
  } catch (error) {
    await deleteMessage(ctx, statusMsg.message_id);
    logger.error({ chatId, wallet, error: error.message }, "Failed to add wallet");
    ctx.reply(`Error: ${error.message}`);
  }
});

bot.command("remove", (ctx) => {
  const wallet = ctx.message.text.split(" ")[1];
  const chatId = String(ctx.chat.id);
  
  if (!wallet) {
    return ctx.reply("Usage: /remove <wallet_address>");
  }
  
  const user = getUser(chatId);
  
  if (!user || !user.wallets || !user.wallets[wallet]) {
    return ctx.reply("Wallet not found");
  }
  
  delete user.wallets[wallet];
  
  if (Object.keys(user.wallets).length === 0) {
    deleteUser(chatId);
  } else {
    setUser(chatId, user);
  }
  
  logger.info({ chatId, wallet }, "Wallet removed");
  ctx.reply(`Wallet removed\n\n\`${wallet}\``, { parse_mode: "Markdown" });
});

bot.command("list", (ctx) => {
  const chatId = String(ctx.chat.id);
  const user = getUser(chatId);
  
  if (!user || !user.wallets || Object.keys(user.wallets).length === 0) {
    return ctx.reply("No wallets configured");
  }
  
  const wallets = Object.keys(user.wallets);
  const lines = wallets.map((w, i) => `${i + 1}. \`${w}\``);
  ctx.reply(`Your wallets:\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

bot.command("check", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const user = getUser(chatId);
  
  if (!user || !user.wallets || Object.keys(user.wallets).length === 0) {
    return ctx.reply("No wallets configured. Use /add <wallet>");
  }
  
  const statusMsg = await ctx.reply("Checking...");
  
  const results = [];
  
  for (const [wallet, walletData] of Object.entries(user.wallets)) {
    try {
      const markets = walletData.markets || [];
      
      if (markets.length === 0) {
        results.push(`\`${wallet}\`\nNo markets cached. Use /refreshmarkets`);
        continue;
      }
      
      const positions = await checkSpecificMarkets(wallet, markets);
      
      if (positions && positions.length > 0) {
        const lines = positions.map(p => 
          `${p.market}: ${p.ltv}% (liq: ${p.liquidationLtv}%) (hf: ${p.healthFactor})`
        );
        results.push(`\`${wallet}\`\n\n${lines.join("\n")}`);
      } else {
        results.push(`\`${wallet}\`\nNo positions`);
      }
    } catch (error) {
      logger.error({ wallet, error: error.message }, "Check failed");
      results.push(`\`${wallet}\`\nError: ${error.message}`);
    }
  }
  
  await deleteMessage(ctx, statusMsg.message_id);
  ctx.reply(results.join("\n\n"), { parse_mode: "Markdown" });
});

bot.command("refreshmarkets", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const user = getUser(chatId);
  
  if (!user || !user.wallets || Object.keys(user.wallets).length === 0) {
    return ctx.reply("No wallets configured. Use /add <wallet>");
  }
  
  const statusMsg = await ctx.reply("Rescanning markets...");
  
  const results = [];
  
  for (const wallet of Object.keys(user.wallets)) {
    try {
      const positions = await scanAllMarketsForWallet(wallet);
      
      if (positions && positions.length > 0) {
        const marketNames = positions.map(p => p.market);
        user.wallets[wallet].markets = marketNames;
        
        const lines = positions.map(p => `${p.market}: ${p.ltv}% (liq: ${p.liquidationLtv}%) (hf: ${p.healthFactor})`);
        results.push(`\`${wallet}\`\n${lines.join("\n")}`);
      } else {
        user.wallets[wallet].markets = [];
        results.push(`\`${wallet}\`\nNo positions found`);
      }
    } catch (error) {
      logger.error({ wallet, error: error.message }, "Refresh failed");
      results.push(`\`${wallet}\`\nError: ${error.message}`);
    }
  }
  
  setUser(chatId, user);
  await deleteMessage(ctx, statusMsg.message_id);
  ctx.reply(`Markets refreshed\n\n${results.join("\n\n")}`, { parse_mode: "Markdown" });
});

bot.command("stop", (ctx) => {
  const chatId = String(ctx.chat.id);
  deleteUser(chatId);
  logger.info({ chatId }, "User stopped monitoring");
  ctx.reply("Monitoring stopped, all wallets removed");
});

async function refreshMarketsBackground() {
  try {
    await fetchMarkets();
  } catch (error) {
    logger.error({ error: error.message }, "Failed to refresh markets in background");
  }
}

async function checkAllUsers() {
  for (const [chatId, user] of getAllUsers()) {
    logger.info({ chatId, user }, "Checking user ltv on background");

    if (!user.wallets) continue;
    
    for (const [wallet, walletData] of Object.entries(user.wallets)) {
      const markets = walletData.markets || [];
      
      logger.info({ chatId, wallet, markets }, "Markets");

      if (markets.length === 0) continue;
      
      try {
        const positions = await checkSpecificMarkets(wallet, markets);
        
        logger.info({ chatId, wallet, positions }, "Positions");

        if (!positions || positions.length === 0) continue;

        
        for (const pos of positions) {
          const ltv = parseFloat(pos.ltv);
          const liquidationLtv = parseFloat(pos.liquidationLtv);
          const healthFactor = liquidationLtv / ltv;

          logger.info({ chatId, wallet, market: pos.market, ltv, liquidationLtv, healthFactor }, "Health factor");
          
          let prefix = "";
          
          if (healthFactor > WARNING_HEALTH_FACTOR) {
            continue;
          }

          if (healthFactor <= DANGER_HEALTH_FACTOR) {
            prefix = "DANGER: ";
          } else if (healthFactor <= WARNING_HEALTH_FACTOR) {
            prefix = "WARNING: ";
          }
          
          logger.info({ chatId, wallet, market: pos.market, ltv }, "LTV changed");
          
          const lines = positions.map(p => 
            `${p.market}: ${p.ltv}% (liq: ${p.liquidationLtv}%) (hf: ${p.healthFactor})`
          );

          bot.telegram.sendMessage(chatId, `${prefix}\`${wallet}\`\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
        }
        
        setUser(chatId, user);
      } catch (error) {
        logger.error({ chatId, wallet, error: error.message }, "Check failed");
      }
    }
  }
}

async function init() {
  try {
    await fetchMarkets();
  } catch (error) {
    logger.error({ error: error.message }, "Failed to load markets on startup");
  }
  
  setInterval(refreshMarketsBackground, CHECK_INTERVAL);
  setInterval(checkAllUsers, CHECK_INTERVAL);
  
  const userCount = getUserCount();
  if (userCount > 0) {
    logger.info({ count: userCount }, "Users loaded");
    setTimeout(checkAllUsers, 5000);
  }
  
  bot.launch();
  logger.info("Bot started");
}

init();

process.once("SIGINT", () => {
  logger.info("Shutting down (SIGINT)");
  bot.stop("SIGINT");
});

process.once("SIGTERM", () => {
  logger.info("Shutting down (SIGTERM)");
  bot.stop("SIGTERM");
});
