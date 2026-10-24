/* Durable forward-test evidence journal.
   Stores bounded, append-only semantic cycle snapshots inside the server durable KV.
   No network, no DOM, no trading decisions. Corruption/capacity failures are fail-closed. */
"use strict";

import { summarizeForwardPerformance } from "./forward-test-metrics.js";

export const FORWARD_TEST_JOURNAL_VERSION = 1;
export const FORWARD_TEST_JOURNAL_KEY = "tw-us-stock-forward-test-journal-v1";
export const DEFAULT_FORWARD_TEST_MAX_ENTRIES = 20_000;

function durableError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeFill(fill) {
  if (!fill || typeof fill !== "object") return null;
  const price = finiteOrNull(fill.fillPrice ?? fill.price);
  const qty = Number(fill.filledQty ?? fill.qty);
  const fee = finiteOrNull(fill.fee);
  if (typeof fill.id !== "string" || !fill.id || !["buy", "sell"].includes(fill.side) || !Number.isInteger(qty) || qty <= 0 || !(price > 0) || fee === null || fee < 0) {
    return null;
  }
  return Object.freeze({
    orderId: fill.id,
    clientOrderId: typeof fill.clientOrderId === "string" ? fill.clientOrderId : null,
    side: fill.side,
    qty,
    price,
    fee,
  });
}

function normalizeAccount(account) {
  if (!account || typeof account !== "object") return null;
  const fields = ["cash", "marketValue", "equity", "realizedPnl", "unrealizedPnl", "totalPnl", "dailyPnl", "totalFees"];
  const values = Object.fromEntries(fields.map((field) => [field, finiteOrNull(account[field])]));
  if (values.equity === null || values.cash === null || values.marketValue === null || values.totalFees === null) return null;
  const positions = Object.values(account.positions ?? {}).map((position) => ({
    symbol: String(position.symbol ?? ""),
    qty: Number(position.qty),
    avgCost: finiteOrNull(position.avgCost),
    last: finiteOrNull(position.last),
    marketValue: finiteOrNull(position.marketValue),
    unrealized: finiteOrNull(position.unrealized),
  })).filter((position) => position.symbol && Number.isInteger(position.qty) && position.qty > 0);
  const orders = Array.isArray(account.orders) ? account.orders : [];
  return Object.freeze({
    ...values,
    sessionKey: typeof account.sessionKey === "string" ? account.sessionKey : null,
    reservedCash: finiteOrNull(account.reservedCash),
    availableCash: finiteOrNull(account.availableCash),
    positions,
    orderCounts: Object.freeze({
      total: orders.length,
      open: orders.filter((order) => order?.status === "OPEN").length,
      filled: orders.filter((order) => order?.status === "FILLED").length,
      canceled: orders.filter((order) => order?.status === "CANCELED").length,
      expired: orders.filter((order) => order?.status === "EXPIRED").length,
    }),
  });
}

function emptyJournal() {
  return {
    version: FORWARD_TEST_JOURNAL_VERSION,
    nextSequence: 1,
    entries: [],
  };
}

function validateStored(value) {
  if (!value || value.version !== FORWARD_TEST_JOURNAL_VERSION || !Number.isInteger(value.nextSequence) || value.nextSequence < 1 || !Array.isArray(value.entries)) {
    throw durableError("DURABLE_JOURNAL_INVALID", "forward-test journal 格式或版本不合法");
  }
  let previousSequence = 0;
  for (const entry of value.entries) {
    if (!entry || entry.version !== FORWARD_TEST_JOURNAL_VERSION || !Number.isInteger(entry.sequence) || entry.sequence <= previousSequence || typeof entry.timestamp !== "string" || !Number.isFinite(Date.parse(entry.timestamp)) || typeof entry.code !== "string" || !entry.code) {
      throw durableError("DURABLE_JOURNAL_INVALID", "forward-test journal entry 損壞");
    }
    if (entry.marketPrice !== null && entry.marketPrice !== undefined && (!Number.isFinite(entry.marketPrice) || entry.marketPrice <= 0)) {
      throw durableError("DURABLE_JOURNAL_INVALID", "forward-test journal marketPrice 損壞");
    }
    if (entry.account !== null && entry.account !== undefined) {
      for (const field of ["cash", "marketValue", "equity", "totalFees"]) {
        if (!Number.isFinite(entry.account?.[field])) throw durableError("DURABLE_JOURNAL_INVALID", `forward-test journal account.${field} 損壞`);
      }
    }
    if (!Array.isArray(entry.fills) || entry.fills.some((fill) => !fill || typeof fill.orderId !== "string" || !["buy", "sell"].includes(fill.side) || !Number.isInteger(fill.qty) || fill.qty <= 0 || !Number.isFinite(fill.price) || fill.price <= 0 || !Number.isFinite(fill.fee) || fill.fee < 0)) {
      throw durableError("DURABLE_JOURNAL_INVALID", "forward-test journal fills 損壞");
    }
    previousSequence = entry.sequence;
  }
  if (value.nextSequence <= previousSequence) throw durableError("DURABLE_JOURNAL_INVALID", "forward-test journal sequence 倒退");
  return value;
}

export function summarizeForwardTestEntries(entries = []) {
  const safe = Array.isArray(entries) ? entries : [];
  const priced = safe.filter((entry) => Number.isFinite(entry?.account?.equity));
  const first = priced[0] ?? null;
  const last = priced.at(-1) ?? null;

  let peak = null;
  let maxDrawdownPct = 0;
  for (const entry of priced) {
    const equity = entry.account.equity;
    peak = peak === null ? equity : Math.max(peak, equity);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - equity) / peak) * 100);
  }

  const codeCounts = {};
  let fillCount = 0;
  let buyFills = 0;
  let sellFills = 0;
  let feesInWindow = 0;
  let turnoverNotional = 0;
  for (const entry of safe) {
    codeCounts[entry.code] = (codeCounts[entry.code] ?? 0) + 1;
    for (const fill of entry.fills ?? []) {
      fillCount += 1;
      if (fill.side === "buy") buyFills += 1;
      if (fill.side === "sell") sellFills += 1;
      feesInWindow += Number(fill.fee) || 0;
      turnoverNotional += (Number(fill.qty) || 0) * (Number(fill.price) || 0);
    }
  }

  const sessionDays = new Set(priced.map((entry) => entry.account.sessionKey).filter(Boolean));
  const startEquity = first?.account?.equity ?? null;
  const endEquity = last?.account?.equity ?? null;
  const equityChange = startEquity !== null && endEquity !== null ? endEquity - startEquity : null;
  const totalReturnPct = startEquity > 0 && endEquity !== null ? ((endEquity - startEquity) / startEquity) * 100 : null;
  const costToTurnoverPct = turnoverNotional > 0 ? (feesInWindow / turnoverNotional) * 100 : null;
  const performance = summarizeForwardPerformance(safe, { strategyReturnPct: totalReturnPct });

  return Object.freeze({
    version: FORWARD_TEST_JOURNAL_VERSION,
    cycleCount: safe.length,
    pricedCycleCount: priced.length,
    sessionDays: sessionDays.size,
    evidenceStart: safe[0]?.timestamp ?? null,
    evidenceEnd: safe.at(-1)?.timestamp ?? null,
    startEquity,
    endEquity,
    equityChange,
    totalReturnPct,
    maxDrawdownPct: priced.length ? maxDrawdownPct : null,
    feesInWindow,
    turnoverNotional,
    costToTurnoverPct,
    cumulativeFees: last?.account?.totalFees ?? null,
    latestRealizedPnl: last?.account?.realizedPnl ?? null,
    latestUnrealizedPnl: last?.account?.unrealizedPnl ?? null,
    fillCount,
    buyFills,
    sellFills,
    staleQuoteBlocks: codeCounts.STALE_QUOTE ?? 0,
    promotionGateFails: codeCounts.PROMOTION_GATE_FAIL ?? 0,
    reconciliationFailures: codeCounts.RECONCILIATION_FAILED ?? 0,
    killSwitchBlocks: codeCounts.KILL_SWITCH ?? 0,
    executedCycles: codeCounts.EXECUTED ?? 0,
    workingOrderCycles: codeCounts.ORDER_WORKING ?? 0,
    ...performance,
    codeCounts: Object.freeze({ ...codeCounts }),
  });
}

export class ForwardTestJournal {
  #storage;
  #maxEntries;
  #state;

  constructor({ storage, maxEntries = DEFAULT_FORWARD_TEST_MAX_ENTRIES } = {}) {
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
      throw new Error("ForwardTestJournal 需要 storage");
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 100) throw new Error("maxEntries 必須是 >=100 的整數");
    this.#storage = storage;
    this.#maxEntries = maxEntries;
    this.#state = this.#load();
  }

  #load() {
    const raw = this.#storage.getItem(FORWARD_TEST_JOURNAL_KEY);
    if (!raw) return emptyJournal();
    try {
      return validateStored(JSON.parse(raw));
    } catch (error) {
      if (error?.code === "DURABLE_JOURNAL_INVALID") throw error;
      throw durableError("DURABLE_JOURNAL_INVALID", `forward-test journal 無法解析：${error?.message ?? "unknown"}`);
    }
  }

  #save() {
    try {
      this.#storage.setItem(FORWARD_TEST_JOURNAL_KEY, JSON.stringify(this.#state));
    } catch (error) {
      if (String(error?.code ?? "").startsWith("DURABLE_")) throw error;
      const wrapped = durableError("DURABLE_JOURNAL_WRITE_FAILED", `forward-test journal 寫入失敗：${error?.message ?? "unknown"}`);
      wrapped.cause = error;
      throw wrapped;
    }
  }

  recordCycle({
    timestamp = new Date().toISOString(),
    symbol,
    code,
    ok = false,
    lifecycle = null,
    promotionPass = null,
    account = null,
    fills = [],
    marketPrice = null,
    detailCode = null,
  } = {}) {
    if (this.#state.entries.length >= this.#maxEntries) {
      throw durableError("DURABLE_JOURNAL_FULL", `forward-test journal 已達上限 ${this.#maxEntries}，拒絕丟棄舊證據`);
    }
    if (typeof symbol !== "string" || !symbol) throw new Error("journal 需要 symbol");
    if (typeof code !== "string" || !code) throw new Error("journal 需要 cycle code");
    const parsedTime = Date.parse(timestamp);
    if (!Number.isFinite(parsedTime)) throw new Error("journal timestamp 無效");

    const normalizedFills = (Array.isArray(fills) ? fills : []).map(normalizeFill).filter(Boolean);
    const entry = {
      version: FORWARD_TEST_JOURNAL_VERSION,
      sequence: this.#state.nextSequence,
      timestamp: new Date(parsedTime).toISOString(),
      symbol,
      code,
      ok: ok === true,
      detailCode: typeof detailCode === "string" && detailCode ? detailCode : null,
      lifecycle: typeof lifecycle === "string" ? lifecycle : null,
      promotionPass: typeof promotionPass === "boolean" ? promotionPass : null,
      marketPrice: Number.isFinite(Number(marketPrice)) && Number(marketPrice) > 0 ? Number(marketPrice) : null,
      account: normalizeAccount(account),
      fills: normalizedFills,
    };
    this.#state = {
      ...this.#state,
      nextSequence: this.#state.nextSequence + 1,
      entries: [...this.#state.entries, entry],
    };
    this.#save();
    return clone(entry);
  }

  entries() {
    return clone(this.#state.entries);
  }

  summary() {
    return summarizeForwardTestEntries(this.#state.entries);
  }
}
