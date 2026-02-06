import { logger } from "../logger.js";

export async function syncBudgetBakers(budgetbakersServiceUrl) {
  try {
    const res = await fetch(`${budgetbakersServiceUrl}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });

    if (res.status === 404) {
      return;
    }

    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new Error(payload.error || `Sync failed: ${res.status}`);
    }

    logger.info("BudgetBakers sync triggered");
  } catch (error) {
    if (error.message?.includes("no credentials")) {
      return;
    }
    logger.error({ error: error.message }, "BudgetBakers sync error");
  }
}
