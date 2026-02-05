import { Telegraf, Markup, session } from "telegraf";
import axios from "axios";
import { env } from "./environment.js";
import { logger } from "./logger.js";

const BOT_TOKEN = env.BOT_TOKEN;
const CORE_SERVICE_URL = env.CORE_SERVICE_URL;

const bot = new Telegraf(BOT_TOKEN);

bot.use(session());

// Ensure session is initialized
bot.use((ctx, next) => {
  ctx.session ??= {};
  return next();
});

const WARNING_HEALTH_FACTOR = 1.5;
const DANGER_HEALTH_FACTOR = 1.3;

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

async function getCoreUser(chatId) {
  const res = await axios.post(`${CORE_SERVICE_URL}/internal/users/telegram/${chatId}`);
  const userId = res.data.userId;
  const userRes = await axios.get(`${CORE_SERVICE_URL}/internal/users/${userId}`);
  return userRes.data;
}

async function saveCoreUser(user) {
  await axios.post(`${CORE_SERVICE_URL}/internal/users/${user.id}`, user);
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

function walletMenu(user, session) {
  const rows = [];
  const wallets = Object.keys(user?.wallets || {});
  session.walletMenu = wallets;
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

function formatResultsByWallet(resultsByWallet, user) {
  const output = [];
  const protocolsOrder = ["kamino", "aave"];
  
  for (const [wallet, protocols] of Object.entries(resultsByWallet)) {
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
      const positions = protocols[protocol];
      const label = protocol === "aave" ? "*AAVE*" : "*KAMINO*";
      output.push(label);
      
      if (positions.error) {
        output.push(`Error: ${positions.error}`);
      } else {
        const lines = positions.map(p => formatPosition({ user, position: p, protocol }));
        output.push(lines.join("\n"));
      }
    }
  }
  return output.join("\n\n");
}

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

async function addWallet(ctx, wallet) {
  const chatId = String(ctx.chat.id);
  const user = await getCoreUser(chatId);
  const statusMsg = await ctx.reply("Adding wallet...");
  
  try {
    const response = await axios.post(`${CORE_SERVICE_URL}/api/wallets/add`, {
      userId: user.id,
      address: wallet
    });
    const { protocol, positions } = response.data;
    
    await deleteMessage(ctx, statusMsg.message_id);
    
    const lines = positions.map(p => formatPosition({ user, position: p, protocol }));
    ctx.reply(`Wallet added!\n\n\`${wallet}\`\n\n${lines.join("\n")}`, { parse_mode: "Markdown" });
  } catch (error) {
    await deleteMessage(ctx, statusMsg.message_id);
    ctx.reply(`Error: ${error.response?.data?.error || error.message}`);
  }
}

async function checkWallets(ctx, user, protocolFilter) {
  const statusMsg = await ctx.reply("Checking...");
  try {
    const response = await axios.get(`${CORE_SERVICE_URL}/api/users/${user.id}/check`);
    let results = response.data;

    if (protocolFilter && protocolFilter !== "all") {
      const filtered = {};
      for (const [wallet, protocols] of Object.entries(results)) {
        if (protocols[protocolFilter]) {
          filtered[wallet] = { [protocolFilter]: protocols[protocolFilter] };
        }
      }
      results = filtered;
    }

    await deleteMessage(ctx, statusMsg.message_id);
    if (Object.keys(results).length === 0) return ctx.reply("No wallets found for this protocol");
    
    ctx.reply(formatResultsByWallet(results, user), { parse_mode: "Markdown" });
  } catch (error) {
    await deleteMessage(ctx, statusMsg.message_id);
    ctx.reply(`Error: ${error.message}`);
  }
}

bot.command("start", (ctx) => {
  ctx.reply("LTV Watch Bot\n\n/menu - open menu");
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
  const user = await getCoreUser(ctx.chat.id);
  const kamino = getThresholds(user, "kamino");
  const aave = getThresholds(user, "aave");
  const lines = [
    `Kamino warning: ${kamino.warning}`,
    `Kamino danger: ${kamino.danger}`,
    `Aave warning: ${aave.warning}`,
    `Aave danger: ${aave.danger}`
  ];
  await ctx.editMessageText(`Your settings:\n\n${lines.join("\n")}`, mainMenu());
});

bot.action("menu:wallets", async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getCoreUser(ctx.chat.id);
  await ctx.editMessageText("Wallets", walletMenu(user, ctx.session));
});

bot.action(/menu:protocol:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const protocol = ctx.match[1];
  const user = await getCoreUser(ctx.chat.id);
  ctx.session.protocol = protocol;
  await ctx.editMessageText(`${protocol.toUpperCase()} menu`, protocolMenu(protocol, user));
});

bot.action(/action:setwarning:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.pending = { action: "setwarning", protocol: ctx.match[1] };
  await ctx.reply(`Send warning health factor for ${ctx.match[1]}`);
});

bot.action(/action:setdanger:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.pending = { action: "setdanger", protocol: ctx.match[1] };
  await ctx.reply(`Send danger health factor for ${ctx.match[1]}`);
});

bot.action(/action:check:(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getCoreUser(ctx.chat.id);
  await checkWallets(ctx, user, ctx.match[1]);
});

bot.action("action:addwallet", async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.pending = { action: "addwallet" };
  await ctx.reply("Send wallet address to add");
});

bot.action(/action:wallet:remove:(\d+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const user = await getCoreUser(ctx.chat.id);
  const wallet = ctx.session.walletMenu?.[ctx.match[1]];
  if (wallet) {
    delete user.wallets[wallet];
    await saveCoreUser(user);
    await ctx.editMessageText("Wallets", walletMenu(user, ctx.session));
  }
});

bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;
  const pending = ctx.session.pending;
  if (!pending) return;

  ctx.session.pending = null;

  if (pending.action === "addwallet") return addWallet(ctx, text.trim());

  if (pending.action === "setwarning" || pending.action === "setdanger") {
    const value = parseFloat(text);
    if (isNaN(value) || value <= 0) return ctx.reply("Send a positive number");
    const user = await getCoreUser(ctx.chat.id);
    if (pending.action === "setwarning") user.settings[pending.protocol].warningHealthFactor = value;
    else user.settings[pending.protocol].dangerHealthFactor = value;
    await saveCoreUser(user);
    await ctx.reply(`${pending.action} for ${pending.protocol} set to ${value}`);
  }
});

bot.launch();
logger.info("Bot started");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
