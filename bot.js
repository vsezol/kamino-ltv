import { Telegraf, Markup } from "telegraf";
import { fetchMarkets, scanAllMarketsForWallet, checkSpecificMarkets } from "./kamino.js";
import { fetchAaveMarketsAll, scanAaveMarketsForWallet, checkAaveMarkets } from "./aave.js";
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

async function editMessage(ctx, messageId, text) {
  try {
    await bot.telegram.editMessageText(ctx.chat.id, messageId, null, text);
  } catch {
    // ignore if message already deleted
  }
}

function isEvmAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

function isSolanaAddress(address) {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}

function detectWalletType(address) {
  if (isEvmAddress(address)) return "evm";
  if (isSolanaAddress(address)) return "solana";
  return "unknown";
}

function ensureUser(chatId) {
  let user = getUser(chatId);
  if (!user) user = {};
  if (!user.wallets) user.wallets = {};
  if (!user.settings) user.settings = {};
  if (!user.settings.kamino) user.settings.kamino = {};
  if (!user.settings.aave) user.settings.aave = {};
  if (!user.ui) user.ui = {};
  return user;
}

function getThresholds(user, protocol) {
  const settings = user?.settings?.[protocol] || {};
  return {
    warning: settings.warningHealthFactor ?? WARNING_HEALTH_FACTOR,
    danger: settings.dangerHealthFactor ?? DANGER_HEALTH_FACTOR
  };
}

function mainMenu() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Kamino", "menu:protocol:kamino"),
      Markup.button.callback("Aave", "menu:protocol:aave")
    ],
    [
      Markup.button.callback("Check All", "action:check:all"),
      Markup.button.callback("Refresh All", "action:refresh:all")
    ],
    [Markup.button.callback("Wallets", "menu:wallets")],
    [Markup.button.callback("Settings", "menu:settings")]
  ]);
}

function protocolMenu(protocol, user) {
  const thresholds = getThresholds(user, protocol);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(`Warning HF: ${thresholds.warning}`, `action:setwarning:${protocol}`),
      Markup.button.callback(`Danger HF: ${thresholds.danger}`, `action:setdanger:${protocol}`)
    ],
    [
      Markup.button.callback("Check", `action:check:${protocol}`),
      Markup.button.callback("Refresh Markets", `action:refresh:${protocol}`)
    ],
    [Markup.button.callback("Back", "menu:main")]
  ]);
}

function formatWalletLabel(wallet) {
  if (!wallet || wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function walletMenu(user) {
  const rows = [];
  const wallets = Object.keys(user?.wallets || {});
  user.ui.walletMenu = wallets;
  for (let i = 0; i < wallets.length; i += 1) {
    const wallet = wallets[i];
    rows.push([
      Markup.button.callback(formatWalletLabel(wallet), `action:wallet:noop:${i}`),
      Markup.button.callback("✖", `action:wallet:remove:${i}`)
    ]);
  }
  rows.push([Markup.button.callback("Add Wallet", "action:addwallet")]);
  rows.push([Markup.button.callback("Back", "menu:main")]);
  return Markup.inlineKeyboard(rows);
}

function formatResultsByWallet(resultsByWallet) {
  const output = [];
  const protocolsOrder = ["kamino", "aave"];
  for (const [wallet, protocols] of resultsByWallet.entries()) {
    output.push(`\`${wallet}\``);
    const protocolKeys = Object.keys(protocols);
    protocolKeys.sort((a, b) => {
      const aIdx = protocolsOrder.indexOf(a);
      const bIdx = protocolsOrder.indexOf(b);
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });
    for (const protocol of protocolKeys) {
      const label = protocol === "aave" ? "*AAVE*" : "*KAMINO*";
      output.push(label);
      output.push(protocols[protocol].join("\n"));
    }
  }
  return output.join("\n\n");
}

async function addWallet(ctx, wallet) {
  if (!wallet || wallet.length < 32) {
    return ctx.reply("Usage: /add <wallet_address>");
  }
  const chatId = String(ctx.chat.id);
  const walletType = detectWalletType(wallet);
  if (walletType === "unknown") {
    return ctx.reply("Unsupported wallet format");
  }
  const protocol = walletType === "evm" ? "aave" : "kamino";
  const statusMsg = await ctx.reply(protocol === "aave" ? "Checking Aave..." : "Scanning all markets...");
  try {
    let positions;
    if (protocol === "aave") {
      positions = await scanAaveMarketsForWallet(wallet);
    } else {
      positions = await scanAllMarketsForWallet(wallet, (marketCheck) => {
        editMessage(ctx, statusMsg.message_id, `Scanning market ${marketCheck.current + 1} of ${marketCheck.total}...`);
      });
    }
    await deleteMessage(ctx, statusMsg.message_id);
    if (!positions || positions.length === 0) {
      return ctx.reply("No positions found for this wallet");
    }
    const user = ensureUser(chatId);
    const marketNames = positions.map(p => p.market);
    user.wallets[wallet] = {
      markets: marketNames,
      protocol
    };
    setUser(chatId, user);
    logger.info({ chatId, wallet, markets: marketNames }, "Wallet added");
    const lines = positions.map(p => formatPosition({ user, position: p, protocol }));
    ctx.reply(`Wallet added!\n\n\`${wallet}\`\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
  } catch (error) {
    await deleteMessage(ctx, statusMsg.message_id);
    logger.error({ chatId, wallet, error: error.message }, "Failed to add wallet");
    ctx.reply(`Error: ${error.message}`);
  }
}

function removeWallet(ctx, wallet) {
  if (!wallet) {
    return ctx.reply("Usage: /remove <wallet_address>");
  }
  const chatId = String(ctx.chat.id);
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
}

async function checkWallets(ctx, user, protocolFilter) {
  const wallets = Object.entries(user.wallets || {}).filter(([_, data]) => {
    if (!protocolFilter || protocolFilter === "all") return true;
    return (data.protocol || "kamino") === protocolFilter;
  });
  if (wallets.length === 0) {
    return ctx.reply("No wallets configured");
  }
  const statusMsg = await ctx.reply("Checking...");
  const grouped = new Map();
  for (const [wallet, walletData] of wallets) {
    try {
      const protocol = walletData.protocol || "kamino";
      const markets = walletData.markets || [];
      if (protocol === "kamino" && markets.length === 0) {
        if (!grouped.has(wallet)) grouped.set(wallet, {});
        grouped.get(wallet)[protocol] = ["No markets cached. Use /refreshmarkets"];
        continue;
      }
      let positions;
      if (protocol === "aave") {
        positions = await checkAaveMarkets(wallet);
      } else {
        positions = await checkSpecificMarkets(wallet, markets);
      }
      if (positions && positions.length > 0) {
        const lines = positions.map(p => formatPosition({ user, position: p, protocol }));
        if (!grouped.has(wallet)) grouped.set(wallet, {});
        grouped.get(wallet)[protocol] = lines;
      } else {
        if (!grouped.has(wallet)) grouped.set(wallet, {});
        grouped.get(wallet)[protocol] = ["No positions"];
      }
    } catch (error) {
      logger.error({ wallet, error: error.message }, "Check failed");
      if (!grouped.has(wallet)) grouped.set(wallet, {});
      grouped.get(wallet)[walletData.protocol || "kamino"] = [`Error: ${error.message}`];
    }
  }
  await deleteMessage(ctx, statusMsg.message_id);
  ctx.reply(formatResultsByWallet(grouped), { parse_mode: "Markdown" });
}

async function refreshMarketsForUser(ctx, user, protocolFilter) {
  const wallets = Object.entries(user.wallets || {}).filter(([_, data]) => {
    if (!protocolFilter || protocolFilter === "all") return true;
    return (data.protocol || "kamino") === protocolFilter;
  });
  if (wallets.length === 0) {
    return ctx.reply("No wallets configured");
  }
  const statusMsg = await ctx.reply("Rescanning markets...");
  const grouped = new Map();
  for (const [wallet, walletData] of wallets) {
    try {
      const protocol = walletData.protocol || "kamino";
      let positions;
      if (protocol === "aave") {
        positions = await scanAaveMarketsForWallet(wallet);
      } else {
        positions = await scanAllMarketsForWallet(wallet);
      }
      if (positions && positions.length > 0) {
        const marketNames = positions.map(p => p.market);
        walletData.markets = marketNames;
        const lines = positions.map(p => formatPosition({ user, position: p, protocol }));
        if (!grouped.has(wallet)) grouped.set(wallet, {});
        grouped.get(wallet)[protocol] = lines;
      } else {
        walletData.markets = [];
        if (!grouped.has(wallet)) grouped.set(wallet, {});
        grouped.get(wallet)[protocol] = ["No positions found"];
      }
    } catch (error) {
      logger.error({ wallet, error: error.message }, "Refresh failed");
      if (!grouped.has(wallet)) grouped.set(wallet, {});
      grouped.get(wallet)[walletData.protocol || "kamino"] = [`Error: ${error.message}`];
    }
  }
  setUser(String(ctx.chat.id), user);
  await deleteMessage(ctx, statusMsg.message_id);
  ctx.reply(`Markets refreshed\n\n${formatResultsByWallet(grouped)}`, { parse_mode: "Markdown" });
}

bot.start((ctx) => {
  ctx.reply(
    "LTV Watch Bot\n\n" +
    "/menu - open menu\n" +
    "/add <wallet> - add wallet to monitor\n" +
    "/remove <wallet> - remove wallet\n" +
    "/list - show your wallets\n" +
    "/check - check LTV for your wallets\n" +
    "/refreshmarkets - rescan markets for your wallets\n" +
    `/setwarning <value> - set warning health factor (default: ${WARNING_HEALTH_FACTOR})\n` +
    `/setdanger <value> - set danger health factor (default: ${DANGER_HEALTH_FACTOR})\n` +
    "/settings - show your current settings\n" +
    "/stop - stop monitoring and remove all wallets"
  );
});

bot.command("menu", (ctx) => {
  ctx.reply("Menu", mainMenu());
});

bot.action("menu:main", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Menu", mainMenu());
});

bot.action("menu:settings", async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  const kamino = getThresholds(user, "kamino");
  const aave = getThresholds(user, "aave");
  const lines = [
    `Kamino warning: ${kamino.warning}${user.settings.kamino.warningHealthFactor ? "" : " (default)"}`,
    `Kamino danger: ${kamino.danger}${user.settings.kamino.dangerHealthFactor ? "" : " (default)"}`,
    `Aave warning: ${aave.warning}${user.settings.aave.warningHealthFactor ? "" : " (default)"}`,
    `Aave danger: ${aave.danger}${user.settings.aave.dangerHealthFactor ? "" : " (default)"}`
  ];
  await ctx.editMessageText(`Your settings:\n\n${lines.join("\n")}`, mainMenu());
});

bot.action("menu:wallets", async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  await ctx.editMessageText("Wallets", walletMenu(user));
  setUser(chatId, user);
});

bot.action(/menu:protocol:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const protocol = ctx.match[1];
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  user.ui.protocol = protocol;
  setUser(chatId, user);
  await ctx.editMessageText(`${protocol.toUpperCase()} menu`, protocolMenu(protocol, user));
});

bot.action(/action:setwarning:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const protocol = ctx.match[1];
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  user.ui.pending = { action: "setwarning", protocol };
  setUser(chatId, user);
  await ctx.reply(`Send warning health factor for ${protocol}`);
});

bot.action(/action:setdanger:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const protocol = ctx.match[1];
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  user.ui.pending = { action: "setdanger", protocol };
  setUser(chatId, user);
  await ctx.reply(`Send danger health factor for ${protocol}`);
});

bot.action(/action:check:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const protocol = ctx.match[1];
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  await checkWallets(ctx, user, protocol);
});

bot.action(/action:refresh:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const protocol = ctx.match[1];
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  await refreshMarketsForUser(ctx, user, protocol);
});

bot.action("action:addwallet", async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  user.ui.pending = { action: "addwallet" };
  setUser(chatId, user);
  await ctx.reply("Send wallet address to add");
});

bot.action("action:removewallet", async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  user.ui.pending = { action: "removewallet" };
  setUser(chatId, user);
  await ctx.reply("Send wallet address to remove");
});

bot.action("action:listwallets", async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  if (!user.wallets || Object.keys(user.wallets).length === 0) {
    return ctx.reply("No wallets configured");
  }
  const wallets = Object.keys(user.wallets);
  const lines = wallets.map((w, i) => `${i + 1}. \`${w}\``);
  await ctx.reply(`Your wallets:\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

bot.action(/action:wallet:noop:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
});

bot.action(/action:wallet:remove:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  const index = Number(ctx.match[1]);
  const wallet = user.ui.walletMenu?.[index];
  if (!wallet) {
    return ctx.reply("Wallet not found");
  }
  removeWallet(ctx, wallet);
  await ctx.editMessageText("Wallets", walletMenu(user));
  setUser(chatId, user);
});

bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  const pending = user.ui?.pending;
  if (!pending) return;

  if (pending.action === "addwallet") {
    user.ui.pending = null;
    setUser(chatId, user);
    return addWallet(ctx, text.trim());
  }

  if (pending.action === "removewallet") {
    user.ui.pending = null;
    setUser(chatId, user);
    return removeWallet(ctx, text.trim());
  }

  if (pending.action === "setwarning" || pending.action === "setdanger") {
    const value = parseFloat(text);
    if (isNaN(value) || value <= 0) {
      return ctx.reply("Send a positive number");
    }
    const protocol = pending.protocol;
    if (!protocol || (protocol !== "aave" && protocol !== "kamino")) {
      user.ui.pending = null;
      setUser(chatId, user);
      return ctx.reply("Unknown protocol");
    }
    if (pending.action === "setwarning") {
      user.settings[protocol].warningHealthFactor = value;
      logger.info({ chatId, protocol, warningHealthFactor: value }, "Warning health factor set");
      await ctx.reply(`Warning health factor for ${protocol} set to ${value}`);
    } else {
      user.settings[protocol].dangerHealthFactor = value;
      logger.info({ chatId, protocol, dangerHealthFactor: value }, "Danger health factor set");
      await ctx.reply(`Danger health factor for ${protocol} set to ${value}`);
    }
    user.ui.pending = null;
    setUser(chatId, user);
  }
});

bot.command("add", async (ctx) => {
  const wallet = ctx.message.text.split(" ")[1];
  await addWallet(ctx, wallet);
});

bot.command("remove", (ctx) => {
  const wallet = ctx.message.text.split(" ")[1];
  removeWallet(ctx, wallet);
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
  const protocol = ctx.message.text.split(" ")[1];
  await checkWallets(ctx, user, protocol);
});

bot.command("refreshmarkets", async (ctx) => {
  const chatId = String(ctx.chat.id);
  const user = getUser(chatId);
  if (!user || !user.wallets || Object.keys(user.wallets).length === 0) {
    return ctx.reply("No wallets configured. Use /add <wallet>");
  }
  const protocol = ctx.message.text.split(" ")[1];
  await refreshMarketsForUser(ctx, user, protocol);
});

bot.command("setwarning", (ctx) => {
  const parts = ctx.message.text.split(" ");
  const value = parseFloat(parts[1]);
  const chatId = String(ctx.chat.id);
  const protocolArg = parts[2]?.toLowerCase();
  const user = ensureUser(chatId);
  const protocol = protocolArg || user.ui.protocol;

  if (isNaN(value) || value <= 0) {
    return ctx.reply("Usage: /setwarning <positive_number>\nExample: /setwarning 1.5");
  }
  if (!protocol || (protocol !== "aave" && protocol !== "kamino")) {
    return ctx.reply("Choose protocol in menu or use /setwarning <value> <aave|kamino>");
  }

  user.settings[protocol].warningHealthFactor = value;
  setUser(chatId, user);

  logger.info({ chatId, protocol, warningHealthFactor: value }, "Warning health factor set");
  ctx.reply(`Warning health factor for ${protocol} set to ${value}`);
});

bot.command("setdanger", (ctx) => {
  const parts = ctx.message.text.split(" ");
  const value = parseFloat(parts[1]);
  const chatId = String(ctx.chat.id);
  const protocolArg = parts[2]?.toLowerCase();
  const user = ensureUser(chatId);
  const protocol = protocolArg || user.ui.protocol;

  if (isNaN(value) || value <= 0) {
    return ctx.reply("Usage: /setdanger <positive_number>\nExample: /setdanger 1.3");
  }
  if (!protocol || (protocol !== "aave" && protocol !== "kamino")) {
    return ctx.reply("Choose protocol in menu or use /setdanger <value> <aave|kamino>");
  }

  user.settings[protocol].dangerHealthFactor = value;
  setUser(chatId, user);

  logger.info({ chatId, protocol, dangerHealthFactor: value }, "Danger health factor set");
  ctx.reply(`Danger health factor for ${protocol} set to ${value}`);
});

bot.command("settings", (ctx) => {
  const chatId = String(ctx.chat.id);
  const user = ensureUser(chatId);
  const kamino = getThresholds(user, "kamino");
  const aave = getThresholds(user, "aave");
  const lines = [
    `Kamino warning: ${kamino.warning}${user.settings.kamino.warningHealthFactor ? "" : " (default)"}`,
    `Kamino danger: ${kamino.danger}${user.settings.kamino.dangerHealthFactor ? "" : " (default)"}`,
    `Aave warning: ${aave.warning}${user.settings.aave.warningHealthFactor ? "" : " (default)"}`,
    `Aave danger: ${aave.danger}${user.settings.aave.dangerHealthFactor ? "" : " (default)"}`
  ];
  ctx.reply(`Your settings:\n\n${lines.join("\n")}`);
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
    await fetchAaveMarketsAll();
  } catch (error) {
    logger.error({ error: error.message }, "Failed to refresh markets in background");
  }
}

async function checkAllUsers() {
  for (const [chatId, user] of getAllUsers()) {
    logger.info({ chatId, user }, "Checking user ltv on background");

    if (!user.wallets) continue;
    
    for (const [wallet, walletData] of Object.entries(user.wallets)) {
      const protocol = walletData.protocol || "kamino";
      const markets = walletData.markets || [];
      const thresholds = getThresholds(user, protocol);
      
      logger.info({ chatId, wallet, markets, protocol }, "Markets");

      if (protocol === "kamino" && markets.length === 0) continue;
      
      try {
        let positions;
        if (protocol === "aave") {
          positions = await checkAaveMarkets(wallet);
        } else {
          positions = await checkSpecificMarkets(wallet, markets);
        }
        
        logger.info({ chatId, wallet, positions }, "Positions");

        if (!positions || positions.length === 0) continue;

        for (const pos of positions) {
          const healthFactor = parseFloat(pos.healthFactor);

          if (!Number.isFinite(healthFactor)) continue;
          if (healthFactor > thresholds.warning) continue;

          logger.info(
            {
              chatId,
              wallet,
              market: pos.market,
              healthFactor,
              dangerHf: thresholds.danger,
              warningHf: thresholds.warning,
              protocol
            },
            "Health factor"
          );
          
          const grouped = new Map();
          grouped.set(wallet, { [protocol]: positions.map(p => formatPosition({ user, position: p, protocol })) });
          bot.telegram.sendMessage(chatId, formatResultsByWallet(grouped), { parse_mode: "Markdown" });
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
    await fetchAaveMarketsAll();
  } catch (error) {
    logger.error({ error: error.message }, "Failed to load markets on startup");
  }
  
  setInterval(refreshMarketsBackground, CHECK_INTERVAL);
  setInterval(checkAllUsers, CHECK_INTERVAL);
  
  try {
    await bot.telegram.setMyCommands([
      { command: "menu", description: "Open menu" },
      { command: "add", description: "Add wallet" },
      { command: "remove", description: "Remove wallet" },
      { command: "list", description: "List wallets" },
      { command: "check", description: "Check LTV (all/aave/kamino)" },
      { command: "refreshmarkets", description: "Refresh markets (all/aave/kamino)" },
      { command: "setwarning", description: "Set warning HF (aave/kamino)" },
      { command: "setdanger", description: "Set danger HF (aave/kamino)" },
      { command: "settings", description: "Show settings" },
      { command: "stop", description: "Stop monitoring" }
    ]);
  } catch (error) {
    logger.error({ error: error.message }, "Failed to set bot commands");
  }
  
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

function formatPosition({ user, position, protocol }) {
  const thresholds = getThresholds(user, protocol || "kamino");

  let prefix = "✅ ";
  if (position.healthFactor <= thresholds.danger) {
    prefix = "☠️ ";
  } else if (position.healthFactor <= thresholds.warning) {
    prefix = "⚠️ ";
  }

  return `${prefix}${position.market}:\nLTV: ${position.ltv}%\nLiquidation LTV: ${position.liquidationLtv}%\nHealth Factor: ${position.healthFactor}`;
}