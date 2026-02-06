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
export const bbBaseUrl = import.meta.env.VITE_BUDGETBAKERS_API_URL || "http://localhost:3005";
export const snowballBaseUrl = import.meta.env.VITE_SNOWBALL_API_URL || "http://localhost:3006";

async function request<T>(path: string, options?: RequestInit, customBaseUrl?: string): Promise<T> {
  const url = customBaseUrl || baseUrl;
  const res = await fetch(`${url}${path}`, {
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

// BudgetBakers API
export interface BBCredentialsStatus {
  connected: boolean;
  email?: string;
  userId?: string;
  updatedAt?: string;
}

export interface BBAccount {
  id: number;
  credentialId: number;
  accountId: string;
  name: string;
  currencyCode?: string;
  balanceCents: number;
  excluded: boolean;
  archived: boolean;
  lastSync?: string;
}

export interface BBCredentialsInput {
  email: string;
  userId: string;
  couchUrl: string;
  couchDb: string;
  couchLogin: string;
  couchToken: string;
}

export async function getBBCredentials(): Promise<BBCredentialsStatus> {
  return request<BBCredentialsStatus>("/api/credentials", undefined, bbBaseUrl);
}

export async function saveBBCredentials(creds: BBCredentialsInput) {
  return request<{ status: string; email: string; message: string }>(
    "/api/credentials",
    {
      method: "POST",
      body: JSON.stringify(creds)
    },
    bbBaseUrl
  );
}

export async function deleteBBCredentials() {
  return request<{ status: string }>("/api/credentials", {
    method: "DELETE"
  }, bbBaseUrl);
}

export async function listBBAccounts(): Promise<{ accounts: BBAccount[]; connected: boolean }> {
  return request<{ accounts: BBAccount[]; connected: boolean }>(
    "/api/accounts",
    undefined,
    bbBaseUrl
  );
}

export async function updateBBAccount(id: number, excluded: boolean) {
  return request<{ status: string }>(`/api/accounts/${id}`, {
    method: "PUT",
    body: JSON.stringify({ excluded })
  }, bbBaseUrl);
}

export async function syncBBAccounts() {
  return request<{ status: string; message: string }>("/api/sync", {
    method: "POST"
  }, bbBaseUrl);
}

export async function getBBTotalBalance(): Promise<{ totalUsd: number; connected: boolean }> {
  return request<{ totalUsd: number; connected: boolean }>(
    "/api/balance",
    undefined,
    bbBaseUrl
  );
}

export async function getBBScript(): Promise<string> {
  const res = await fetch(`${bbBaseUrl}/api/script`);
  return res.text();
}

export interface BBHistoryPoint {
  balanceCents: number;
  balanceUsd?: number;
  recordedAt: string;
}

export async function fetchBBAccountHistory(accountId: number, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  const data = await request<{ 
    accountId: number; 
    name: string; 
    currency?: string;
    points: BBHistoryPoint[] 
  }>(
    `/api/accounts/${accountId}/history${query ? `?${query}` : ""}`,
    undefined,
    bbBaseUrl
  );
  return data;
}

// Snowball Income API
export interface SnowballCredentialsStatus {
  connected: boolean;
  email?: string;
  updatedAt?: string;
}

export interface SnowballPortfolio {
  id: number;
  credentialId: number;
  portfolioId: string;
  name: string;
  currency?: string;
  isComposite: boolean;
  currentCostUsd: number;
  incomePercent: number;
  excluded: boolean;
  lastSync?: string;
}

export interface SnowballHistoryPoint {
  balanceUsd: number;
  recordedAt: string;
}

export async function getSnowballCredentials(): Promise<SnowballCredentialsStatus> {
  return request<SnowballCredentialsStatus>("/api/credentials", undefined, snowballBaseUrl);
}

export async function saveSnowballCredentials(email: string, password: string) {
  return request<{ status: string; message: string }>(
    "/api/credentials",
    {
      method: "POST",
      body: JSON.stringify({ email, password })
    },
    snowballBaseUrl
  );
}

export async function deleteSnowballCredentials() {
  return request<{ status: string }>("/api/credentials", {
    method: "DELETE"
  }, snowballBaseUrl);
}

export async function listSnowballPortfolios(): Promise<{ portfolios: SnowballPortfolio[]; connected: boolean }> {
  return request<{ portfolios: SnowballPortfolio[]; connected: boolean }>(
    "/api/portfolios",
    undefined,
    snowballBaseUrl
  );
}

export async function updateSnowballPortfolio(id: number, excluded: boolean) {
  return request<{ status: string }>(`/api/portfolios/${id}`, {
    method: "PUT",
    body: JSON.stringify({ excluded })
  }, snowballBaseUrl);
}

export async function syncSnowballPortfolios() {
  return request<{ status: string; message: string }>("/api/sync", {
    method: "POST"
  }, snowballBaseUrl);
}

export async function getSnowballTotalBalance(): Promise<{ totalUsd: number; connected: boolean }> {
  return request<{ totalUsd: number; connected: boolean }>(
    "/api/balance",
    undefined,
    snowballBaseUrl
  );
}

export async function fetchSnowballPortfolioHistory(portfolioId: number, from?: string, to?: string) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  const data = await request<{ 
    portfolioId: number; 
    name: string; 
    currency?: string;
    points: SnowballHistoryPoint[] 
  }>(
    `/api/portfolios/${portfolioId}/history${query ? `?${query}` : ""}`,
    undefined,
    snowballBaseUrl
  );
  return data;
}
