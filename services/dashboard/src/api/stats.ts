export interface Wallet {
  id: number;
  address: string;
  assetClass: string;
  label?: string | null;
  createdAt: string;
  latestPriceUsd?: number | null;
  latestAt?: string | null;
}

export interface PricePoint {
  priceUsd: number;
  recordedAt: string;
}

export const baseUrl = import.meta.env.VITE_STATS_API_URL || "http://localhost:3003";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const message = payload.error || "Request failed";
    throw new Error(message);
  }
  return res.json();
}

export async function listWallets(): Promise<Wallet[]> {
  const data = await request<{ wallets: Wallet[] }>("/api/wallets");
  return data.wallets;
}

export async function createWallet(address: string, label?: string) {
  return request<Wallet>("/api/wallets", {
    method: "POST",
    body: JSON.stringify({ address, label })
  });
}

export async function fetchWalletHistory(walletId: number, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  const data = await request<{ points: PricePoint[] }>(
    `/api/wallets/${walletId}/history${query ? `?${query}` : ""}`
  );
  return data.points;
}

export async function fetchAggregateHistory(from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  const data = await request<{ points: PricePoint[] }>(
    `/api/history${query ? `?${query}` : ""}`
  );
  return data.points;
}
