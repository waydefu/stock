/* 風控與稽核：先判斷、再讓 paper broker 改狀態；拒絕要有代碼與可行動原因。 */
"use strict";

const DEFAULT_RISK = {
  maxOrderNotionalPct: 0.2,
  maxDailyLossPct: 0.02,
  maxPositions: 10,
};

const ROLE_PERMISSIONS = {
  observer: ["market:read", "research:read", "audit:read"],
  trader: ["market:read", "research:read", "audit:read", "paper:order"],
  risk: ["market:read", "research:read", "audit:read", "paper:order", "risk:trip", "risk:reset"],
  maintainer: ["market:read", "research:read", "audit:read", "paper:order", "risk:trip", "risk:reset", "repo:change"],
};

export function permissionsFor(role) { return [...(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.observer)]; }

export class RiskEngine {
  #config;
  #tripped = false;
  #reason = "";

  constructor(config = {}) { this.#config = { ...DEFAULT_RISK, ...config }; }

  approveOrder(account, order) {
    if (this.#tripped) return { ok: false, code: "KILL_SWITCH", reason: `斷路器已啟動：${this.#reason}` };
    const equity = Number(account?.equity ?? 0);
    if (!Number.isFinite(equity) || equity <= 0) return { ok: false, code: "NO_EQUITY", reason: "帳戶權益無效，停止下單" };
    const dailyPnl = Number(account?.dailyPnl ?? 0);
    const dailyLossPct = Math.abs(Math.min(0, dailyPnl)) / equity;
    if (dailyLossPct >= this.#config.maxDailyLossPct) {
      this.trip(`日損 ${roundPct(dailyLossPct)}% 達到 ${roundPct(this.#config.maxDailyLossPct)}% 上限`);
      return { ok: false, code: "DAILY_LOSS_LIMIT", reason: "已達日損斷路器上限，請風控官確認後重置" };
    }
    const notional = Number(order?.qty) * Number(order?.price);
    if (!Number.isFinite(notional) || notional <= 0) return { ok: false, code: "INVALID_NOTIONAL", reason: "數量或價格無效" };
    if (notional > equity * this.#config.maxOrderNotionalPct) {
      return { ok: false, code: "ORDER_NOTIONAL_LIMIT", reason: `單筆名目金額超過 ${roundPct(this.#config.maxOrderNotionalPct)}% 上限` };
    }
    const positions = account?.positions ?? {};
    if (order.side === "buy" && !positions[order.symbol] && Object.keys(positions).length >= this.#config.maxPositions) {
      return { ok: false, code: "POSITION_LIMIT", reason: `持倉檔數達 ${this.#config.maxPositions} 檔上限` };
    }
    if (order.side === "buy" && notional > Number(account.cash ?? 0)) {
      return { ok: false, code: "INSUFFICIENT_CASH", reason: "現金不足，請降低數量或先釋放資金" };
    }
    return { ok: true, code: "APPROVED", reason: "通過紙上交易風控" };
  }

  trip(reason = "manual") { this.#tripped = true; this.#reason = String(reason); }
  reset() { this.#tripped = false; this.#reason = ""; }
  isTripped() { return this.#tripped; }
  status() { return { tripped: this.#tripped, reason: this.#reason, config: { ...this.#config } }; }
}

function roundPct(value) { return (value * 100).toFixed(2); }

function safeDetails(details) {
  if (!details || typeof details !== "object") return details;
  if (Array.isArray(details)) return details.map(safeDetails);
  const result = {};
  for (const [key, value] of Object.entries(details)) {
    if (/secret|token|password|api[_-]?key|credential|certificate/i.test(key)) continue;
    result[key] = value && typeof value === "object" ? safeDetails(value) : value;
  }
  return result;
}

export class AuditLog {
  #events = [];
  #now;
  constructor({ now = () => new Date().toISOString() } = {}) { this.#now = now; }
  record(event, details = {}) {
    const entry = { timestamp: this.#now(), event: String(event), details: safeDetails(details) };
    this.#events.push(entry);
    return { ...entry };
  }
  list() { return this.#events.map((entry) => ({ ...entry })); }
  clear() { this.#events = []; }
  toCSV() {
    const rows = [["timestamp", "event", "details"]];
    for (const entry of this.#events) rows.push([entry.timestamp, entry.event, JSON.stringify(entry.details)]);
    return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  }
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export { DEFAULT_RISK, ROLE_PERMISSIONS };
