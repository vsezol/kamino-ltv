import express from "express";
import axios from "axios";
import { env } from "./environment.js";
import { findOrCreateUserByTelegramId, getUserData, saveUserData, deleteUser, getAllUserIds } from "./db.js";
import { logger } from "./logger.js";

const app = express();
const port = env.PORT;

const AAVE_SERVICE_URL = env.AAVE_SERVICE_URL;
const KAMINO_SERVICE_URL = env.KAMINO_SERVICE_URL;

app.use(express.json());

// Auth / User management
app.post("/internal/users/telegram/:chatId", async (req, res) => {
  try {
    const userId = await findOrCreateUserByTelegramId(req.params.chatId);
    res.json({ userId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/internal/users/:id", async (req, res) => {
  try {
    const data = await getUserData(req.params.id);
    if (!data) return res.status(404).json({ error: "User not found" });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/internal/users/:id", async (req, res) => {
  try {
    await saveUserData(req.params.id, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/internal/users/:id", async (req, res) => {
  try {
    await deleteUser(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/internal/users", async (req, res) => {
  try {
    const ids = await getAllUserIds();
    res.json(ids);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Orchestration API for Bot
app.post("/api/wallets/add", async (req, res) => {
  const { userId, address } = req.body;
  const user = await getUserData(userId);
  if (!user) return res.status(404).json({ error: "User not found" });

  const protocol = /^0x[a-fA-F0-9]{40}$/.test(address) ? "aave" : "kamino";
  const serviceUrl = protocol === "aave" ? AAVE_SERVICE_URL : KAMINO_SERVICE_URL;

  try {
    const response = await axios.get(`${serviceUrl}/scan/${address}`);
    const positions = response.data;

    if (!positions || positions.length === 0) {
      return res.status(400).json({ error: "No positions found" });
    }

    user.wallets[address] = { protocol };
    await saveUserData(userId, user);

    res.json({ protocol, positions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/users/:id/check", async (req, res) => {
  const user = await getUserData(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });

  const results = {};
  const wallets = Object.entries(user.wallets);

  for (const [address, data] of wallets) {
    try {
      const protocol = data.protocol;
      const serviceUrl = protocol === "aave" ? AAVE_SERVICE_URL : KAMINO_SERVICE_URL;
      
      let positions;
      if (protocol === "aave") {
        const response = await axios.get(`${serviceUrl}/check/${address}`);
        positions = response.data;
      } else {
        const response = await axios.post(`${serviceUrl}/check/${address}`, { markets: [] });
        positions = response.data;
      }
      
      if (!results[address]) results[address] = {};
      results[address][protocol] = positions;
    } catch (error) {
      if (!results[address]) results[address] = {};
      results[address][data.protocol] = { error: error.message };
    }
  }

  res.json(results);
});

app.post("/api/users/:id/refresh", async (req, res) => {
  try {
    await Promise.all([
      axios.get(`${AAVE_SERVICE_URL}/refresh-markets`),
      axios.get(`${KAMINO_SERVICE_URL}/refresh-markets`)
    ]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  logger.info(`Core service listening on port ${port}`);
});
