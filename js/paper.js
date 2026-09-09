/* 紙上交易帳本：只在本機持久化模擬餘額、持倉、訂單。
   BrokerAdapter 介面刻意與真實券商隔離；本檔沒有網路請求，也不讀任何秘密。 */
"use strict";

import { createOrder, transitionOrder } from "./order-state.js";

const STORAGE_KEY = "tw-us-stock-paper-v1";
const PAPER_SCHEMA_VERSION = 1;
const DEFAULTS = {
  TW: { currency: "TWD", initialCash: 1_000_000 },
  US: { currency: "USD", initialCash: 100_000 },
};

export class MemoryStorage {
  #map = new Map();
  getItem(key) { return this.#map.has(key) ? this.#map.get(key) : null; }
  setItem(key, value) { this.#map.set(key, String(value)); }
  removeItem(key) { this.#map.delete(key); }
}

function defaultState() {
  return {
    schemaVersion: PAPER_SCHEMA_VERSION,
    TW: { currency: "TWD", initialCash: DEFAULTS.TW.initialCash, cash: DEFAULTS.TW.initialCash, sessionKey: null, sessionOpenEquity: DEFAULTS.TW.initialCash, positions: {}, orders: [] },
    US: { currency: "USD", initialCash: DEFAULTS.US.initialCash, cash: DEFAULTS.US.initialCash, sessionKey: null, sessionOpenEquity: DEFAULTS.US.initialCash, positions: {}, orders: [] },
  };
}

function validAccountOrDefault(candidate, market) {
  const fallback = defaultState()[market];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return fallback;
  const account = { ...fallback, ...candidate };
  if (!Number.isFinite(Number(account.initialCash)) || Number(account.initialCash) <= 0 || !Number.isFinite(Number(account.cash)) || Number(account.cash) < 0) return fallback;
  if (!account.positions || typeof account.positions !== "object" || Array.isArray(account.positions) || !Array.isArray(account.orders)) return fallback;
  for (const position of Object.values(account.positions)) {
    if (!position || !Number.isInteger(position.qty) || position.qty <= 0 || !Number.isFinite(Number(position.avgCost)) || Number(position.avgCost) <= 0) return fallback;
  }
  return { ...account, initialCash: Number(account.initialCash), cash: Number(account.cash) };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function browserStorage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function sessionKeyFrom(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) throw new Error("paper account clock returned an invalid timestamp");
  return date.toISOString().slice(0, 10);
}

function defaultOrderId({ market, timestamp, sequence }) {
  return `P-${market}-${timestamp.replace(/[^0-9]/g, "").slice(0, 14)}-${sequence}`;
}

export class PaperBroker {
  #storage;
  #now;
  #idGenerator;
  #state;

  constructor({ storage = browserStorage() ?? new MemoryStorage(), now = () => new Date().toISOString(), idGenerator = defaultOrderId } = {}) {
    this.#storage = storage;
    this.#now = now;
    this.#idGenerator = idGenerator;
    this.#state = this.#load();
  }

  #load() {
    const raw = this.#storage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    try {
      const value = JSON.parse(raw);
      const fresh = defaultState();
      if (value.schemaVersion !== undefined && value.schemaVersion !== PAPER_SCHEMA_VERSION) return fresh;
      for (const market of Object.keys(DEFAULTS)) {
        fresh[market] = validAccountOrDefault(value[market], market);
      }
      return fresh;
    } catch {
      // 壞掉的本機展示資料不能默默拿去交易；重置為明確的紙上初始帳本。
      return defaultState();
    }
  }

  #save() { this.#storage.setItem(STORAGE_KEY, JSON.stringify(this.#state)); }

  #ensureSession(account, equity) {
    const key = sessionKeyFrom(this.#now());
    if (account.sessionKey === null || account.sessionKey === undefined) {
      account.sessionKey = key;
      if (!Number.isFinite(account.sessionOpenEquity)) account.sessionOpenEquity = account.initialCash;
      this.#save();
      return;
    }
    if (account.sessionKey !== key) {
      account.sessionKey = key;
      account.sessionOpenEquity = equity;
      this.#save();
    }
  }

  snapshot(market = "TW", quotes = {}) {
    this.#assertMarket(market);
    const account = this.#state[market];
    let marketValue = 0;
    const positions = clone(account.positions);
    for (const [symbol, position] of Object.entries(positions)) {
      const price = Number(quotes[symbol]?.price ?? position.avgCost);
      position.last = price;
      position.marketValue = price * position.qty;
      position.unrealized = (price - position.avgCost) * position.qty;
      marketValue += position.marketValue;
    }
    const equity = account.cash + marketValue;
    this.#ensureSession(account, equity);
    const dailyPnl = equity - account.sessionOpenEquity;
    return clone({
      schemaVersion: PAPER_SCHEMA_VERSION,
      market,
      currency: account.currency,
      initialCash: account.initialCash,
      cash: account.cash,
      marketValue,
      equity,
      dailyPnl,
      dailyPnlPct: account.sessionOpenEquity === 0 ? 0 : (dailyPnl / account.sessionOpenEquity) * 100,
      dailyLossReferenceEquity: account.sessionOpenEquity,
      sessionKey: account.sessionKey,
      positions,
      orders: account.orders,
    });
  }

  findOrder(market = "TW", clientOrderId) {
    this.#assertMarket(market);
    if (!clientOrderId) return null;
    const found = this.#state[market].orders.find((order) => order.clientOrderId === clientOrderId);
    return found ? clone(found) : null;
  }

  placeOrder({ market = "TW", symbol, side, qty, price, clientId = "manual", clientOrderId }) {
    this.#assertMarket(market);
    if (!clientOrderId || typeof clientOrderId !== "string") throw new Error("clientOrderId 必須存在");
    if (!symbol || !/^[A-Za-z0-9.]+$/.test(String(symbol))) throw new Error("標的代號格式不正確");
    if (!(["buy", "sell"].includes(side))) throw new Error("只支援 buy 或 sell");
    if (!Number.isInteger(qty) || qty <= 0) throw new Error("數量必須是正整數");
    if (!Number.isFinite(price) || price <= 0) throw new Error("價格必須是正數");
    const account = this.#state[market];
    const duplicate = account.orders.find((existingOrder) => existingOrder.clientOrderId === clientOrderId);
    if (duplicate) return clone(duplicate);
    const existing = account.positions[symbol];
    const notional = qty * price;
    const timestamp = this.#now();
    let order = createOrder({
      id: this.#idGenerator({ market, timestamp, sequence: account.orders.length + 1 }),
      clientId,
      clientOrderId,
      market,
      symbol: String(symbol),
      side,
      qty,
      price,
      notional,
      mode: "paper",
    }, { now: () => timestamp });
    order = transitionOrder(order, "VALIDATE", { now: () => timestamp });
    if (side === "buy") {
      if (account.cash < notional) throw new Error("現金不足：紙上帳戶拒絕這筆訂單");
      const nextQty = (existing?.qty ?? 0) + qty;
      const nextAvg = existing ? ((existing.avgCost * existing.qty) + notional) / nextQty : price;
      account.cash -= notional;
      account.positions[symbol] = { symbol, qty: nextQty, avgCost: nextAvg };
    } else {
      if (!existing || existing.qty < qty) throw new Error("持倉不足：目前紙上帳戶不允許裸賣");
      account.cash += notional;
      if (existing.qty === qty) delete account.positions[symbol];
      else account.positions[symbol] = { ...existing, qty: existing.qty - qty };
    }
    order = transitionOrder(order, "FILL", { now: () => timestamp, reason: "immediate paper simulation" });
    account.orders.unshift(order);
    account.orders = account.orders.slice(0, 100);
    this.#save();
    return clone(order);
  }

  reset(market = "TW") {
    this.#assertMarket(market);
    this.#state[market] = defaultState()[market];
    this.#save();
    return this.snapshot(market);
  }

  #assertMarket(market) {
    if (!Object.hasOwn(DEFAULTS, market)) throw new Error(`不支援市場：${market}`);
  }
}

export { STORAGE_KEY };
