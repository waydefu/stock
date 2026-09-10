/* 風控與稽核：先判斷、再讓 paper broker 改狀態；拒絕要有代碼與可行動原因。 */
import { defaultLotForMarket, validateQuantity, validateTick, validatePriceLimit, validateOrderTypeInSession } from "./market-rules.js";
import { ORDER_ERROR_CODE } from "./order-errors.js";

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

const AUDIT_STORAGE_KEY = "tw-us-stock-audit-v1";

export function permissionsFor(role) { return [...(ROLE_PERMISSIONS[role] ?? ROLE_PERMISSIONS.observer)]; }

export class RiskEngine {
  #config;
  #tripped = false;
  #reason = "";

  constructor(config = {}) { this.#config = { ...DEFAULT_RISK, ...config }; }

  /**
   * 風控決策的評估時點（evaluation time）來源：
   * context.now（執行邊界在 commit 當下注入的權威時鐘）優先；
   * order.timestamp 僅為 preview-only 舊呼叫者的相容退路；最後才用 Date.now()。
   * Confirm 路徑必須經 executePaperOrder 注入 now，不得依賴 preview 留下的 timestamp。
   */
  approveOrder(account, order, context = {}) {
    if (this.#tripped) return { ok: false, code: "KILL_SWITCH", reason: `斷路器已啟動：${this.#reason}` };
    const equity = Number(account?.equity ?? 0);
    if (!Number.isFinite(equity) || equity <= 0) return { ok: false, code: "NO_EQUITY", reason: "帳戶權益無效，停止下單" };
    if (!["TW", "US"].includes(order?.market)) return { ok: false, code: ORDER_ERROR_CODE.INVALID_MARKET, reason: "市場必須是 TW 或 US" };
    if (!order?.symbol || !/^[A-Za-z0-9.]+$/.test(String(order.symbol))) return { ok: false, code: "INVALID_SYMBOL", reason: "標的代號格式不正確" };
    if (!["buy", "sell"].includes(order?.side)) return { ok: false, code: "INVALID_SIDE", reason: "交易方向必須是 buy 或 sell" };
    if (!Number.isInteger(order?.qty) || order.qty <= 0) return { ok: false, code: "INVALID_QTY", reason: "數量必須是正整數" };
    if (!Number.isFinite(order?.price) || order.price <= 0) return { ok: false, code: "INVALID_PRICE", reason: "價格必須是正數" };
    const quantityDecision = validateQuantity(order.market, order.qty, order.lot ?? defaultLotForMarket(order.market));
    if (!quantityDecision.ok) return { ok: false, code: quantityDecision.code, reason: quantityDecision.reason };

    // Tick size validation
    const tickDecision = validateTick(order.market, order.price);
    if (!tickDecision.ok) return { ok: false, code: tickDecision.code, reason: tickDecision.reason };

    // Price limit validation (requires reference price for TW)
    if (order.market === "TW") {
      if (!Number.isFinite(order.referencePrice) || order.referencePrice <= 0) {
        return { ok: false, code: "REFERENCE_PRICE_REQUIRED", reason: "台股漲跌幅驗證需提供參考價" };
      }
      const priceLimitDecision = validatePriceLimit(order.market, order.price, order.referencePrice);
      if (!priceLimitDecision.ok) {
        // Map codes to stable ones
        const codeMap = {
          "PRICE_LIMIT_UP": "PRICE_ABOVE_LIMIT",
          "PRICE_LIMIT_DOWN": "PRICE_BELOW_LIMIT",
        };
        return { ok: false, code: codeMap[priceLimitDecision.code] ?? priceLimitDecision.code, reason: priceLimitDecision.reason };
      }

      // Session validation for TW only — evaluated at commit time, never at stale preview time.
      const evaluationTs = context.now ?? order.timestamp ?? Date.now();
      const sessionDecision = validateOrderTypeInSession(order.market, order.orderType ?? "limit", evaluationTs);
      if (!sessionDecision.ok) {
        return { ok: false, code: sessionDecision.code === "OUTSIDE_TRADING_HOURS" ? "MARKET_CLOSED" : sessionDecision.code, reason: sessionDecision.reason };
      }
    }

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
  #events;
  #now;
  #idGenerator;
  #storage;
  #sequence;

  constructor({ now = () => new Date().toISOString(), idGenerator = ({ sequence }) => `audit-${sequence}`, storage = null } = {}) {
    this.#now = now;
    this.#idGenerator = idGenerator;
    this.#storage = storage;
    this.#events = loadAuditEvents(storage);
    this.#sequence = this.#events.length;
  }

  #save() {
    if (!this.#storage) return;
    try { this.#storage.setItem(AUDIT_STORAGE_KEY, JSON.stringify({ version: 1, events: this.#events })); } catch { /* local persistence is best effort */ }
  }

  record(event, details = {}) {
    const timestamp = this.#now();
    const entry = {
      version: 1,
      eventId: this.#idGenerator({ sequence: ++this.#sequence, timestamp, event: String(event) }),
      timestamp,
      event: String(event),
      details: safeDetails(details),
    };
    this.#events.push(entry);
    this.#save();
    return { ...entry };
  }

  list() { return this.#events.map((entry) => ({ ...entry, details: safeDetails(entry.details) })); }

  toCSV() {
    const rows = [["version", "eventId", "timestamp", "event", "details"]];
    for (const entry of this.#events) rows.push([entry.version, entry.eventId, entry.timestamp, entry.event, JSON.stringify(entry.details)]);
    return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  }
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function loadAuditEvents(storage) {
  if (!storage) return [];
  try {
    const raw = storage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) return [];
    const payload = JSON.parse(raw);
    if (payload.version !== 1 || !Array.isArray(payload.events)) return [];
    return payload.events.filter((entry) => entry && entry.version === 1 && typeof entry.eventId === "string" && typeof entry.timestamp === "string" && typeof entry.event === "string" && entry.details && typeof entry.details === "object");
  } catch {
    return [];
  }
}

export { DEFAULT_RISK, ROLE_PERMISSIONS };
