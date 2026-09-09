/* 紙上交易帳本：只在本機持久化模擬餘額、持倉、訂單。
   BrokerAdapter 介面刻意與真實券商隔離；本檔沒有網路請求，也不讀任何秘密。 */
"use strict";

import { ACCOUNTING_VERSION, ZERO_FEE_MODEL, createAccountSnapshot, feeFor } from "./accounting.js";
import { createExecutionModel, ExecutionMode } from "./execution-model.js";
import { MarketSessionClock } from "./session-clock.js";
import { ORDER_ERROR_CODE, OrderError } from "./order-errors.js";
import { createOrder, ORDER_STATUS } from "./order-state.js";

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
    TW: { accountingVersion: ACCOUNTING_VERSION, currency: "TWD", initialCash: DEFAULTS.TW.initialCash, cash: DEFAULTS.TW.initialCash, realizedPnl: 0, totalFees: 0, feeModel: ZERO_FEE_MODEL.name, sessionKey: null, sessionOpenEquity: DEFAULTS.TW.initialCash, positions: {}, orders: [] },
    US: { accountingVersion: ACCOUNTING_VERSION, currency: "USD", initialCash: DEFAULTS.US.initialCash, cash: DEFAULTS.US.initialCash, realizedPnl: 0, totalFees: 0, feeModel: ZERO_FEE_MODEL.name, sessionKey: null, sessionOpenEquity: DEFAULTS.US.initialCash, positions: {}, orders: [] },
  };
}

function validPersistedOrder(order, market, ids) {
  if (!order || typeof order !== "object" || order.market !== market || typeof order.id !== "string" || typeof order.clientOrderId !== "string" || !order.clientOrderId || !order.symbol || !/^[A-Za-z0-9.]+$/.test(order.symbol) || !["buy", "sell"].includes(order.side) || !Number.isInteger(order.qty) || order.qty <= 0 || !Number.isFinite(order.price) || order.price <= 0 || !Object.values(ORDER_STATUS).includes(order.status) || !Array.isArray(order.events)) return false;
  if (ids.has(order.id) || ids.has(`client:${order.clientOrderId}`)) return false;
  ids.add(order.id);
  ids.add(`client:${order.clientOrderId}`);
  return true;
}

function validAccountOrDefault(candidate, market) {
  const fallback = defaultState()[market];
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return fallback;
  const account = { ...fallback, ...candidate };
  if (!Number.isFinite(Number(account.initialCash)) || Number(account.initialCash) <= 0 || !Number.isFinite(Number(account.cash)) || Number(account.cash) < 0) return fallback;
  if (!Number.isFinite(Number(account.realizedPnl)) || !Number.isFinite(Number(account.totalFees)) || Number(account.totalFees) < 0 || typeof account.feeModel !== "string") return fallback;
  if (!account.positions || typeof account.positions !== "object" || Array.isArray(account.positions) || !Array.isArray(account.orders)) return fallback;
  for (const position of Object.values(account.positions)) {
    if (!position || !Number.isInteger(position.qty) || position.qty <= 0 || !Number.isFinite(Number(position.avgCost)) || Number(position.avgCost) <= 0) return fallback;
  }
  const orderIds = new Set();
  if (!account.orders.every((order) => validPersistedOrder(order, market, orderIds))) return fallback;
  return { ...account, initialCash: Number(account.initialCash), cash: Number(account.cash), realizedPnl: Number(account.realizedPnl), totalFees: Number(account.totalFees) };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function browserStorage() {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function defaultOrderId({ market, timestamp, sequence }) {
  return `P-${market}-${timestamp.replace(/[^0-9]/g, "").slice(0, 14)}-${sequence}`;
}

export class PaperBroker {
  #storage;
  #now;
  #idGenerator;
  #feeModel;
  #executionModel;
  #sessionClock;
  #state;

  constructor({ storage = browserStorage() ?? new MemoryStorage(), now = () => new Date().toISOString(), idGenerator = defaultOrderId, feeModel = ZERO_FEE_MODEL, executionMode = ExecutionMode.IMMEDIATE, sessionClock = new MarketSessionClock() } = {}) {
    this.#storage = storage;
    this.#now = now;
    this.#idGenerator = idGenerator;
    this.#feeModel = feeModel;
    this.#executionModel = createExecutionModel(executionMode);
    this.#sessionClock = sessionClock;
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

  #ensureSession(account, equity, market) {
    const key = this.#sessionClock.sessionKey(market, this.#now());
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
    this.#ensureSession(account, equity, market);
    return clone(createAccountSnapshot({
      market,
      currency: account.currency,
      initialCash: account.initialCash,
      cash: account.cash,
      realizedPnl: account.realizedPnl,
      totalFees: account.totalFees,
      feeModel: account.feeModel,
      sessionKey: account.sessionKey,
      sessionOpenEquity: account.sessionOpenEquity,
      positions,
      orders: account.orders,
    }));
  }

  findOrder(market = "TW", clientOrderId) {
    this.#assertMarket(market);
    if (!clientOrderId) return null;
    const found = this.#state[market].orders.find((order) => order.clientOrderId === clientOrderId);
    return found ? clone(found) : null;
  }

  placeOrder({ market = "TW", symbol, side, qty, price, clientId = "manual", clientOrderId }) {
    this.#assertMarket(market);
    if (!clientOrderId || typeof clientOrderId !== "string") throw new OrderError(ORDER_ERROR_CODE.VALIDATION_REJECTED, "clientOrderId 必須存在");
    if (!symbol || !/^[A-Za-z0-9.]+$/.test(String(symbol))) throw new OrderError(ORDER_ERROR_CODE.INVALID_SYMBOL, "標的代號格式不正確");
    if (!( ["buy", "sell"].includes(side))) throw new OrderError(ORDER_ERROR_CODE.INVALID_SIDE, "只支援 buy 或 sell");
    if (!Number.isInteger(qty) || qty <= 0) throw new OrderError(ORDER_ERROR_CODE.INVALID_QTY, "數量必須是正整數");
    if (!Number.isFinite(price) || price <= 0) throw new OrderError(ORDER_ERROR_CODE.INVALID_PRICE, "價格必須是正數");
    const account = this.#state[market];
    const duplicate = account.orders.find((existingOrder) => existingOrder.clientOrderId === clientOrderId);
    if (duplicate) return clone(duplicate);
    const existing = account.positions[symbol];
    const notional = qty * price;
    const fee = feeFor(this.#feeModel, { market, symbol: String(symbol), side, qty, price, notional });
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
      fee,
      feeModel: this.#feeModel.name,
      executionMode: this.#executionModel.mode,
      mode: "paper",
    }, { now: () => timestamp });
    if (side === "buy") {
      if (account.cash < notional + fee) throw new OrderError(ORDER_ERROR_CODE.INSUFFICIENT_CASH, "現金不足：紙上帳戶拒絕這筆訂單");
      const nextQty = (existing?.qty ?? 0) + qty;
      const nextAvg = existing ? ((existing.avgCost * existing.qty) + notional + fee) / nextQty : (notional + fee) / qty;
      account.cash -= notional + fee;
      account.totalFees += fee;
      account.positions[symbol] = { symbol, qty: nextQty, avgCost: nextAvg };
    } else {
      if (!existing || existing.qty < qty) throw new OrderError(ORDER_ERROR_CODE.INSUFFICIENT_POSITION, "持倉不足：目前紙上帳戶不允許裸賣");
      account.cash += notional - fee;
      account.realizedPnl += (price - existing.avgCost) * qty - fee;
      account.totalFees += fee;
      if (existing.qty === qty) delete account.positions[symbol];
      else account.positions[symbol] = { ...existing, qty: existing.qty - qty };
    }
    order = this.#executionModel.execute(order, { timestamp });
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
