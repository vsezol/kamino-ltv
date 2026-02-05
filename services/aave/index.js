import express from "express";
import { env } from "./environment.js";
import { scanAaveMarketsForWallet, checkAaveMarkets, fetchAaveMarketsAll } from "./aave.js";
import { logger } from "./logger.js";

const app = express();
const port = env.PORT;

app.use(express.json());

app.get("/scan/:address", async (req, res) => {
  const { address } = req.params;
  try {
    const positions = await scanAaveMarketsForWallet(address);
    res.json(positions);
  } catch (error) {
    logger.error({ address, error: error.message }, "Aave scan failed");
    res.status(500).json({ error: error.message });
  }
});

app.get("/check/:address", async (req, res) => {
  const { address } = req.params;
  try {
    const positions = await checkAaveMarkets(address);
    res.json(positions);
  } catch (error) {
    logger.error({ address, error: error.message }, "Aave check failed");
    res.status(500).json({ error: error.message });
  }
});

app.get("/refresh-markets", async (req, res) => {
  try {
    const markets = await fetchAaveMarketsAll();
    res.json(markets);
  } catch (error) {
    logger.error({ error: error.message }, "Aave refresh markets failed");
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  logger.info(`Aave microservice listening on port ${port}`);
});
