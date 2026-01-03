import { readFileSync, writeFileSync, existsSync } from "fs";
import { logger } from "./logger.js";

const DB_FILE = "./db.json";

const defaultDb = {
  markets: [],
  marketsUpdatedAt: null,
  users: {}
};

let db = null;

export function loadDb() {
  if (!existsSync(DB_FILE)) {
    db = { ...defaultDb };
    return db;
  }
  
  try {
    db = JSON.parse(readFileSync(DB_FILE, "utf-8"));
    return db;
  } catch (error) {
    logger.error({ error: error.message }, "Failed to load db");
    db = { ...defaultDb };
    return db;
  }
}

export function saveDb() {
  if (!db) return;
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

export function getDb() {
  if (!db) loadDb();
  return db;
}

export function getMarkets() {
  return getDb().markets;
}

export function setMarkets(markets) {
  const d = getDb();
  d.markets = markets;
  d.marketsUpdatedAt = new Date().toISOString();
  saveDb();
}

export function getUser(chatId) {
  const d = getDb();
  return d.users[chatId];
}

export function setUser(chatId, user) {
  const d = getDb();
  d.users[chatId] = user;
  saveDb();
}

export function deleteUser(chatId) {
  const d = getDb();
  delete d.users[chatId];
  saveDb();
}

export function getUserCount() {
  return Object.keys(getDb().users).length;
}

export function getAllUsers() {
  return Object.entries(getDb().users);
}

