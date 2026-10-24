/* 紙上交易帳本：只在本機持久化模擬餘額、持倉、訂單。
   BrokerAdapter 介面刻意與真實券商隔離；本檔沒有網路請求，也不讀任何秘密。
   MATCHING v1 只做 deterministic full-fill limit lifecycle，不虛構 L2 queue／部分成交。 */
"use strict";

import { ACCOUNTING_VERSION, ZERO_FEE_MODEL, createAccountSnapshot, feeFor } from "./accounting.js";
import { createExecutionModel, ExecutionMode } from "./execution-model.js";
import { MarketSessionClock } from "./session-clock.js";
import { defaultLotForMarket, validateQuantity } from "./market-rules.js";
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
  if (!order || typeof order !== "object" || order.market !== market || typeof order.id !== "string" || typeof order.clientOrderId !== "string" || !order.clientOrderId || !order.symbol || !/^[A-Za-z0-9.]+$/.test(order.symbol) || !["buy", "sell"].includes(order.side) || !Number.isInteger(order.qty) || order.qty <= 0 || !Number.isFinite(order.price) || order.price <= 0 || (order.lot !== undefined && !["regular", "oddLot"].includes(order.lot)) || !Object.values(ORDER_STATUS).includes(order.status) || !Array.isArray(order.events)) return false;
  if (order.executionMode !== undefined && !Object.values(ExecutionMode).includes(order.executionMode)) return false;
  if (order.filledQty !== undefined && (!Number.isInteger(order.filledQty) || order.filledQty < 0 || order.filledQty > order.qty)) return false;
  if (order.remainingQty !== undefined && (!Number.isInteger(order.remainingQty) || order.remainingQty < 0 || order.remainingQty > order.qty)) return false;
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

function minutesInTimezone(timestamp, timezone) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

export class PaperBroker {
  #storage;
  #now;
  #idGenerator;
  #feeModel;
  #defaultExecutionMode;
  #sessionClock;
  #state;

  constructor({ storage = browserStorage() ?? new MemoryStorage(), now = () => new Date().toISOString(), idGenerator = defaultOrderId, feeModel = ZERO_FEE_MODEL, executionMode = ExecutionMode.IMMEDIATE, sessionClock = new MarketSessionClock() } = {}) {
    this.#storage = storage;
    this.#now = now;
    this.#idGenerator = idGenerator;
    this.#feeModel = feeModel;
    createExecutionModel(executionMode); // fail fast on unsupported mode
    this.#defaultExecutionMode = executionMode;
    this.#sessionClock = sessionClock;
    this.#state = this.#load();
  }

  #load() {
    const raw = this.#storage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    try {
      const value = JSON.parse(raw);
      const fresh = defaultState();
      if (value.schemaVersion !== undefined && value.schemaVersion !== PAPER_SCHEMA_VERSION) {
        if (this.#storage) {
          try {
            const auditRaw = this.#storage.getItem("tw-us-stock-audit-v1");
            if (auditRaw) {
              const auditPayload = JSON.parse(auditRaw);
              if (auditPayload.version === 1 && Array.isArray(auditPayload.events)) {
                auditPayload.events.push({
                  version: 1,
                  eventId: `audit-${auditPayload.events.length + 1}`,
                  timestamp: new Date().toISOString(),
                  event: "PERSISTENCE_RESET",
                  details: { reason: "schema_version_mismatch", expected: PAPER_SCHEMA_VERSION, found: value.schemaVersion },
                });
                this.#storage.setItem("tw-us-stock-audit-v1", JSON.stringify(auditPayload));
              }
            }
          } catch {
            // audit persistence is best effort
          }
        }
        return fresh;
      }
      for (const market of Object.keys(DEFAULTS)) fresh[market] = validAccountOrDefault(value[market], market);
      return fresh;
    } catch {
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

  #reservations(account, excludeOrderId = null) {
    let reservedCash = 0;
    const reservedPositions = {};
    for (const order of account.orders) {
      if (order.id === excludeOrderId || order.status !== ORDER_STATUS.OPEN || order.executionMode !== ExecutionMode.MATCHING) continue;
      const remaining = Number.isInteger(order.remainingQty) ? order.remainingQty : order.qty;
      if (order.side === "buy") {
        const notional = remaining * order.price;
        const fee = feeFor(this.#feeModel, { market: order.market, symbol: order.symbol, side: order.side, qty: remaining, price: order.price, notional });
        reservedCash += notional + fee;
      } else {
        reservedPositions[order.symbol] = (reservedPositions[order.symbol] ?? 0) + remaining;
      }
    }
    return { reservedCash, reservedPositions };
  }

  #applyFill(account, order, price) {
    const qty = order.remainingQty ?? order.qty;
    const notional = qty * price;
    const fee = feeFor(this.#feeModel, { market: order.market, symbol: order.symbol, side: order.side, qty, price, notional });
    const existing = account.positions[order.symbol];

    if (order.side === "buy") {
      if (account.cash < notional + fee) throw new OrderError(ORDER_ERROR_CODE.INSUFFICIENT_CASH, "現金不足：紙上帳戶拒絕成交");
      const nextQty = (existing?.qty ?? 0) + qty;
      const nextAvg = existing ? ((existing.avgCost * existing.qty) + notional + fee) / nextQty : (notional + fee) / qty;
      account.cash -= notional + fee;
      account.totalFees += fee;
      account.positions[order.symbol] = { symbol: order.symbol, qty: nextQty, avgCost: nextAvg };
    } else {
      if (!existing || existing.qty < qty) throw new OrderError(ORDER_ERROR_CODE.INSUFFICIENT_POSITION, "持倉不足：目前紙上帳戶不允許裸賣");
      account.cash += notional - fee;
      account.realizedPnl += (price - existing.avgCost) * qty - fee;
      account.totalFees += fee;
      if (existing.qty === qty) delete account.positions[order.symbol];
      else account.positions[order.symbol] = { ...existing, qty: existing.qty - qty };
    }
    return { qty, notional, fee };
  }

  snapshot(market = "TW", quotes = {}, { excludeOrderId = null } = {}) {
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
    const base = createAccountSnapshot({
      market,
      currency: account.currency,
      initialCash: account.initialCash,
      cash: account.cash,
      realizedPnl: account.realizedPnl,
      totalFees: account.totalFees,
      feeModel: this.#feeModel.name,
      sessionKey: account.sessionKey,
      sessionOpenEquity: account.sessionOpenEquity,
      positions,
      orders: account.orders,
    });
    const { reservedCash, reservedPositions } = this.#reservations(account, excludeOrderId);
    return clone({
      ...base,
      reservedCash,
      availableCash: Math.max(0, base.cash - reservedCash),
      reservedPositions,
    });
  }

  findOrder(market = "TW", clientOrderId) {
    this.#assertMarket(market);
    if (!clientOrderId) return null;
    const found = this.#state[market].orders.find((order) => order.clientOrderId === clientOrderId);
    return found ? clone(found) : null;
  }

  findOrderById(market = "TW", orderId) {
    this.#assertMarket(market);
    const found = this.#state[market].orders.find((order) => order.id === orderId);
    return found ? clone(found) : null;
  }

  openOrders(market = "TW") {
    this.#assertMarket(market);
    return clone(this.#state[market].orders.filter((order) => order.status === ORDER_STATUS.OPEN));
  }

  placeOrder({
    market = "TW",
    symbol,
    side,
    qty,
    price,
    lot = defaultLotForMarket(market),
    clientId = "manual",
    clientOrderId,
    orderType = "limit",
    timeInForce = "DAY",
    referencePrice = undefined,
    executionMode = this.#defaultExecutionMode,
  }) {
    this.#assertMarket(market);
    if (!clientOrderId || typeof clientOrderId !== "string") throw new OrderError(ORDER_ERROR_CODE.VALIDATION_REJECTED, "clientOrderId 必須存在");
    if (!symbol || !/^[A-Za-z0-9.]+$/.test(String(symbol))) throw new OrderError(ORDER_ERROR_CODE.INVALID_SYMBOL, "標的代號格式不正確");
    if (!["buy", "sell"].includes(side)) throw new OrderError(ORDER_ERROR_CODE.INVALID_SIDE, "只支援 buy 或 sell");
    if (!Number.isInteger(qty) || qty <= 0) throw new OrderError(ORDER_ERROR_CODE.INVALID_QTY, "數量必須是正整數");
    const quantityDecision = validateQuantity(market, qty, lot);
    if (!quantityDecision.ok) throw new OrderError(quantityDecision.code, quantityDecision.reason);
    if (!Number.isFinite(price) || price <= 0) throw new OrderError(ORDER_ERROR_CODE.INVALID_PRICE, "價格必須是正數");
    if (!Object.values(ExecutionMode).includes(executionMode)) throw new OrderError(ORDER_ERROR_CODE.VALIDATION_REJECTED, "不支援 execution mode");
    if (executionMode === ExecutionMode.MATCHING && (orderType !== "limit" || timeInForce !== "DAY")) {
      throw new OrderError(ORDER_ERROR_CODE.VALIDATION_REJECTED, "MATCHING v1 只支援 DAY limit order");
    }

    const account = this.#state[market];
    const duplicate = account.orders.find((existingOrder) => existingOrder.clientOrderId === clientOrderId);
    if (duplicate) return clone(duplicate);

    const model = createExecutionModel(executionMode);
    const notional = qty * price;
    const fee = feeFor(this.#feeModel, { market, symbol: String(symbol), side, qty, price, notional });
    const { reservedCash, reservedPositions } = this.#reservations(account);
    if (side === "buy" && account.cash - reservedCash < notional + fee) {
      throw new OrderError(ORDER_ERROR_CODE.INSUFFICIENT_CASH, "可用現金不足：既有掛單已保留部分資金");
    }
    const existing = account.positions[symbol];
    const reservedQty = reservedPositions[symbol] ?? 0;
    if (side === "sell" && (!existing || existing.qty - reservedQty < qty)) {
      throw new OrderError(ORDER_ERROR_CODE.INSUFFICIENT_POSITION, "可用持倉不足：既有掛單已保留部分部位");
    }

    const timestamp = this.#now();
    const createdSessionKey = this.#sessionClock.sessionKey(market, timestamp);
    let order = createOrder({
      id: this.#idGenerator({ market, timestamp, sequence: account.orders.length + 1 }),
      clientId,
      clientOrderId,
      market,
      symbol: String(symbol),
      side,
      lot,
      qty,
      price,
      orderType,
      timeInForce,
      referencePrice,
      notional,
      fee,
      feeModel: this.#feeModel.name,
      executionMode,
      createdSessionKey,
      mode: "paper",
    }, { now: () => timestamp });

    if (executionMode === ExecutionMode.IMMEDIATE) {
      const applied = this.#applyFill(account, order, price);
      order = model.execute({ ...order, ...applied }, { timestamp });
    } else {
      order = model.execute(order, { timestamp });
    }

    account.orders.unshift(order);
    account.orders = account.orders.slice(0, 100);
    this.#save();
    return clone(order);
  }

  fillOpenOrder(market, orderId, { price, timestamp = this.#now(), reason = "last-trade touch" } = {}) {
    this.#assertMarket(market);
    const account = this.#state[market];
    const index = account.orders.findIndex((order) => order.id === orderId);
    if (index < 0) throw new OrderError(ORDER_ERROR_CODE.BROKER_REJECTED, `找不到掛單：${orderId}`);
    const order = account.orders[index];
    if (order.status !== ORDER_STATUS.OPEN || order.executionMode !== ExecutionMode.MATCHING) {
      throw new OrderError(ORDER_ERROR_CODE.INVALID_TRANSITION, "只有 MATCHING OPEN order 可成交");
    }
    const fillPrice = Number(price);
    if (!Number.isFinite(fillPrice) || fillPrice <= 0) throw new OrderError(ORDER_ERROR_CODE.INVALID_PRICE, "成交價格必須是正數");

    const { reservedCash, reservedPositions } = this.#reservations(account, order.id);
    const qty = order.remainingQty ?? order.qty;
    const notional = qty * fillPrice;
    const fee = feeFor(this.#feeModel, { market, symbol: order.symbol, side: order.side, qty, price: fillPrice, notional });
    if (order.side === "buy" && account.cash - reservedCash < notional + fee) {
      throw new OrderError(ORDER_ERROR_CODE.INSUFFICIENT_CASH, "成交時可用現金不足");
    }
    if (order.side === "sell") {
      const existing = account.positions[order.symbol];
      const otherReserved = reservedPositions[order.symbol] ?? 0;
      if (!existing || existing.qty - otherReserved < qty) throw new OrderError(ORDER_ERROR_CODE.INSUFFICIENT_POSITION, "成交時可用持倉不足");
    }

    const applied = this.#applyFill(account, order, fillPrice);
    const model = createExecutionModel(ExecutionMode.MATCHING);
    const filled = model.fill({ ...order, ...applied }, { timestamp, price: fillPrice, reason });
    account.orders[index] = filled;
    this.#save();
    return clone(filled);
  }

  cancelOrder(market, orderId, { timestamp = this.#now(), reason = "user request" } = {}) {
    this.#assertMarket(market);
    const account = this.#state[market];
    const index = account.orders.findIndex((order) => order.id === orderId);
    if (index < 0) throw new OrderError(ORDER_ERROR_CODE.BROKER_REJECTED, `找不到掛單：${orderId}`);
    const order = account.orders[index];
    if (order.status !== ORDER_STATUS.OPEN || order.executionMode !== ExecutionMode.MATCHING) {
      throw new OrderError(ORDER_ERROR_CODE.INVALID_TRANSITION, "只有 MATCHING OPEN order 可取消");
    }
    const canceled = createExecutionModel(ExecutionMode.MATCHING).cancel(order, { timestamp, reason });
    account.orders[index] = canceled;
    this.#save();
    return clone(canceled);
  }

  expireOpenOrders(market, { timestamp = this.#now() } = {}) {
    this.#assertMarket(market);
    const account = this.#state[market];
    const currentSessionKey = this.#sessionClock.sessionKey(market, timestamp);
    const model = createExecutionModel(ExecutionMode.MATCHING);
    const expired = [];
    account.orders = account.orders.map((order) => {
      if (order.status !== ORDER_STATUS.OPEN || order.executionMode !== ExecutionMode.MATCHING || order.timeInForce !== "DAY") return order;
      const sameSession = order.createdSessionKey === currentSessionKey;
      const twMinutes = market === "TW" ? minutesInTimezone(timestamp, "Asia/Taipei") : null;
      const afterTwClose = market === "TW" && Number.isFinite(twMinutes) && twMinutes >= 13 * 60 + 30;
      if (sameSession && !afterTwClose) return order;
      const reason = afterTwClose && sameSession ? "TW DAY order expired at 13:30 close" : `DAY expired before session ${currentSessionKey}`;
      const next = model.expire(order, { timestamp, reason });
      expired.push(next);
      return next;
    });
    if (expired.length) this.#save();
    return clone(expired);
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
