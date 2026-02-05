export function parseUSD(text) {
  if (!text) return 0;
  const cleaned = text.replace(/[$,\s]/g, "");
  return Number.parseFloat(cleaned) || 0;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeAddress(address) {
  return address.trim();
}

export function detectWalletType(address) {
  const value = address.trim();
  if (value.startsWith("0x") && value.length === 42) return "evm";
  if (value.startsWith("T") && value.length >= 34) return "tron";
  if (value.startsWith("bc1") || value.startsWith("1") || value.startsWith("3")) return "btc";
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return "sol";
  return "unknown";
}
