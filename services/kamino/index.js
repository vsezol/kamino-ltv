import express from "express";
import { env } from "./environment.js";
import { scanAllMarketsForWallet, checkSpecificMarkets, fetchMarkets } from "./kamino.js";
import { logger } from "./logger.js";

const app = express();
const port = env.PORT;

app.use(express.json());

app.get("/scan/:address", async (req, res) => {
  const { address } = req.params;
  try {
    const positions = await scanAllMarketsForWallet(address);
    res.json(positions);
  } catch (error) {
    logger.error({ address, error: error.message }, "Kamino scan failed");
    res.status(500).json({ error: error.message });
  }
});

app.post("/check/:address", async (req, res) => {
  const { address } = req.params;
  const { markets } = req.body;
  try {
    const positions = await checkSpecificMarkets(address, markets);
    res.json(positions);
  } catch (error) {
    logger.error({ address, markets, error: error.message }, "Kamino check failed");
    res.status(500).json({ error: error.message });
  }
});

app.get("/refresh-markets", async (req, res) => {
  try {
    const markets = await fetchMarkets();
    res.json(markets);
  } catch (error) {
    logger.error({ error: error.message }, "Kamino refresh markets failed");
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  logger.info(`Kamino microservice listening on port ${port}`);
});
