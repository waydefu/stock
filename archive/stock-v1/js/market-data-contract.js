/* Market-data boundary contracts (provider-neutral).
   No network, no secrets, no provider branching here: UI / backtest / research
   depend only on these shapes. Real providers (Fugle / Shioaji / Alpaca / IBKR)
   are adapted behind this file; see js/fixture-provider.js for the test double.
   Backoff shape follows Alpaca's official 429 guidance (1s, 2s, 4s, … capped,
   plus jitter); thresholds below are OUR freshness policy, not exchange rules. */
"use strict";

export const NORMALIZATION_VERSION = 1;

export const DATA_KINDS = Object.freeze({
  SIMULATION: "simulation",
  DELAYED: "delayed",
  REALTIME: "realtime",
  HISTORICAL: "historical",
});

export const FRESHNESS = Object.freeze({
  FRESH: "FRESH",
  STALE: "STALE",
  UNKNOWN: "UNKNOWN",
});

export const ADAPTER_STATUS = Object.freeze({
  READY: "READY",
  DEGRADED: "DEGRADED",
  STALE: "STALE",
  DISCONNECTED: "DISCONNECTED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  RATE_LIMITED: "RATE_LIMITED",
});

export const DATA_ERROR_CODE = Object.freeze({
  INVALID_SYMBOL: "INVALID_SYMBOL",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_FAILED: "AUTH_FAILED",
  RATE_LIMITED: "RATE_LIMITED",
  TIMEOUT: "TIMEOUT",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  DATA_STALE: "DATA_STALE",
  DATA_INVALID: "DATA_INVALID",
  DATA_DUPLICATE: "DATA_DUPLICATE",
  DATA_OUT_OF_ORDER: "DATA_OUT_OF_ORDER",
  DATA_GAP: "DATA_GAP",
  UNKNOWN_GAP: "UNKNOWN_GAP",
  UNSUPPORTED_CAPABILITY: "UNSUPPORTED_CAPABILITY",
});

export class MarketDataError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "MarketDataError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new MarketDataError(code, message, details);
}

/* Deliverable 1 — provider capability model. No `if provider === X` outside adapters. */
const CAPABILITY_KEYS = ["quote", "historicalBars", "realtimeStream", "snapshot", "corporateActions", "fundamentals"];

export function describeCapability({ provider, markets, capabilities, dataKinds, transport, auth }) {
  if (typeof provider !== "string" || !provider) fail(DATA_ERROR_CODE.DATA_INVALID, "capability 需要 provider 識別");
  if (!Array.isArray(markets) || !markets.length) fail(DATA_ERROR_CODE.DATA_INVALID, "capability 需要 markets");
  if (!capabilities || typeof capabilities !== "object") fail(DATA_ERROR_CODE.DATA_INVALID, "capability 需要 capabilities");
  for (const key of CAPABILITY_KEYS) {
    if (typeof capabilities[key] !== "boolean") fail(DATA_ERROR_CODE.DATA_INVALID, `capability.${key} 必須是 boolean`);
  }
  if (!Array.isArray(dataKinds) || !dataKinds.length) fail(DATA_ERROR_CODE.DATA_INVALID, "capability 需要 dataKinds");
  return Object.freeze({
    provider,
    markets: Object.freeze([...markets]),
    capabilities: Object.freeze({ ...capabilities }),
    dataKinds: Object.freeze([...dataKinds]),
    transport: transport ?? "unknown",
    auth: auth ?? "unknown",
  });
}

/* Deliverable 2 — envelope: every normalized payload carries provenance. */
export function wrapEnvelope(data, { provider, market, symbol, dataKind, providerTimestamp = null, receivedAt = null, source = "unknown", requestId = null, cached = false, pointInTime = "unknown", adjustmentMode = "unknown", now = Date.now() } = {}) {
  if (typeof provider !== "string" || !provider) fail(DATA_ERROR_CODE.DATA_INVALID, "envelope 需要 provider");
  const freshness = evaluateFreshness({ providerTimestamp, receivedAt, now, dataKind });
  return Object.freeze({
    data,
    meta: Object.freeze({
      provider,
      market: market ?? null,
      symbol: symbol ?? null,
      dataKind: dataKind ?? null,
      providerTimestamp: Number.isFinite(providerTimestamp) ? providerTimestamp : null,
      receivedAt: Number.isFinite(receivedAt) ? receivedAt : null,
      freshnessMs: freshness.ageMs,
      stale: freshness.status === FRESHNESS.STALE,
      freshnessStatus: freshness.status,
      source,
      requestId,
      cached: cached === true,
      pointInTime: ["unknown", "true", "false"].includes(String(pointInTime)) ? String(pointInTime) : "unknown",
      adjustmentMode: ["unknown", "adjusted", "unadjusted"].includes(String(adjustmentMode)) ? String(adjustmentMode) : "unknown",
      normalizationVersion: NORMALIZATION_VERSION,
    }),
  });
}

/* Deliverable 3 — freshness policy. Thresholds are OUR policy, not exchange rules. */
export const FRESHNESS_THRESHOLD_MS = Object.freeze({
  [DATA_KINDS.REALTIME]: 30_000,
  [DATA_KINDS.DELAYED]: 20 * 60_000,
  [DATA_KINDS.SIMULATION]: null,
  [DATA_KINDS.HISTORICAL]: null,
});

const CLOCK_SKEW_TOLERANCE_MS = 5_000;

export function evaluateFreshness({ providerTimestamp = null, receivedAt = null, now = Date.now(), dataKind = null } = {}) {
  const ts = Number.isFinite(providerTimestamp) ? providerTimestamp : null;
  const rx = Number.isFinite(receivedAt) ? receivedAt : null;
  if (ts === null || rx === null) return { status: FRESHNESS.UNKNOWN, ageMs: null, thresholdMs: null, reason: "missing-timestamp" };
  if (ts > now + CLOCK_SKEW_TOLERANCE_MS) return { status: FRESHNESS.UNKNOWN, ageMs: null, thresholdMs: null, reason: "future-timestamp" };
  if (dataKind === DATA_KINDS.HISTORICAL) return { status: FRESHNESS.UNKNOWN, ageMs: now - ts, thresholdMs: null, reason: "historical-has-no-liveness" };
  if (dataKind === DATA_KINDS.SIMULATION) return { status: FRESHNESS.FRESH, ageMs: now - ts, thresholdMs: null, reason: "local-deterministic" };
  const thresholdMs = FRESHNESS_THRESHOLD_MS[dataKind] ?? null;
  if (thresholdMs === null) return { status: FRESHNESS.UNKNOWN, ageMs: now - ts, thresholdMs: null, reason: "unknown-data-kind" };
  const ageMs = now - ts;
  return ageMs <= thresholdMs
    ? { status: FRESHNESS.FRESH, ageMs, thresholdMs, reason: "within-threshold" }
    : { status: FRESHNESS.STALE, ageMs, thresholdMs, reason: "over-threshold" };
}

/* Deliverable 4 — normalized quote. Unknown fields are null, never 0 / "" / fake. */
export function normalizeQuote(raw, { market = null } = {}) {
  const symbol = typeof raw?.code === "string" && raw.code ? raw.code : (typeof raw?.symbol === "string" && raw.symbol ? raw.symbol : null);
  if (!symbol) fail(DATA_ERROR_CODE.DATA_INVALID, "quote 缺 symbol");
  if (!Number.isFinite(raw?.price)) fail(DATA_ERROR_CODE.DATA_INVALID, `quote ${symbol} 缺有效 price`);
  const prev = Number.isFinite(raw?.prev) ? raw.prev : (Number.isFinite(raw?.previousClose) ? raw.previousClose : null);
  const change = Number.isFinite(raw?.chg) ? raw.chg
    : Number.isFinite(raw?.change) ? raw.change
    : (prev !== null ? raw.price - prev : null);
  const changePct = Number.isFinite(raw?.pct) ? raw.pct
    : Number.isFinite(raw?.changePct) ? raw.changePct
    : (prev !== null && prev !== 0 ? ((raw.price - prev) / prev) * 100 : null);
  return Object.freeze({
    symbol,
    market,
    price: raw.price,
    previousClose: prev,
    change,
    changePct,
    volume: Number.isFinite(raw?.vol) ? raw.vol : (Number.isFinite(raw?.volume) ? raw.volume : null),
    timestamp: Number.isFinite(raw?.t) ? raw.t : (Number.isFinite(raw?.timestamp) ? raw.timestamp : null),
  });
}

/* Deliverable 5 — normalized bars with strict invariants. */
function barIssue(bar, index) {
  if (!bar || typeof bar !== "object") return { code: DATA_ERROR_CODE.DATA_INVALID, index, detail: "bar 不是物件" };
  if (!Number.isFinite(bar.t)) return { code: DATA_ERROR_CODE.DATA_INVALID, index, detail: "timestamp 非有限數" };
  for (const key of ["o", "h", "l", "c"]) {
    if (!Number.isFinite(bar[key])) return { code: DATA_ERROR_CODE.DATA_INVALID, index, detail: `${key} 非有限數` };
  }
  if (bar.h < Math.max(bar.o, bar.c, bar.l)) return { code: DATA_ERROR_CODE.DATA_INVALID, index, detail: "high 低於 OHLC 上界" };
  if (bar.l > Math.min(bar.o, bar.c, bar.h)) return { code: DATA_ERROR_CODE.DATA_INVALID, index, detail: "low 高於 OHLC 下界" };
  if (!Number.isFinite(bar.v) || bar.v < 0) return { code: DATA_ERROR_CODE.DATA_INVALID, index, detail: "volume 非法" };
  return null;
}

export function validateBars(bars) {
  if (!Array.isArray(bars)) return { ok: false, code: DATA_ERROR_CODE.DATA_INVALID, index: -1, detail: "bars 不是陣列" };
  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      if (bars[i]?.t === bars[i - 1]?.t) return { ok: false, code: DATA_ERROR_CODE.DATA_DUPLICATE, index: i, detail: "重複 timestamp" };
      if (bars[i]?.t < bars[i - 1]?.t) return { ok: false, code: DATA_ERROR_CODE.DATA_OUT_OF_ORDER, index: i, detail: "timestamp 倒退" };
    }
    const issue = barIssue(bars[i], i);
    if (issue) return { ok: false, ...issue };
  }
  return { ok: true, code: "VALID" };
}

export function normalizeBars(bars) {
  const verdict = validateBars(bars);
  if (!verdict.ok) fail(verdict.code, `bars 未通過驗證：${verdict.detail ?? verdict.code}`, { index: verdict.index });
  return Object.freeze(bars.map((b) => Object.freeze({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })));
}

/* Deliverable 6 — gap classification. Insufficient calendar context → UNKNOWN_GAP. */
export function classifyBars(bars) {
  const verdict = validateBars(bars);
  if (!verdict.ok) return [{ code: verdict.code, index: verdict.index, detail: verdict.detail }];
  if (bars.length < 4) {
    const issues = [];
    for (let i = 1; i < bars.length; i++) {
      if (bars[i].t - bars[i - 1].t <= 0) continue;
      issues.push({ code: DATA_ERROR_CODE.UNKNOWN_GAP, index: i, detail: "樣本不足以建立節奏，無法判定缺棒是否合法" });
      break;
    }
    return issues;
  }
  const steps = [];
  for (let i = 1; i < bars.length; i++) steps.push(bars[i].t - bars[i - 1].t);
  const median = [...steps].sort((a, b) => a - b)[Math.floor(steps.length / 2)];
  const issues = [];
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].t - bars[i - 1].t > median * 3) {
      issues.push({ code: DATA_ERROR_CODE.DATA_GAP, index: i, detail: `間隔 ${bars[i].t - bars[i - 1].t}ms 超過中位節奏 ${median}ms 三倍（週末／休市／halt 皆可能合法，需日曆判定）` });
    }
  }
  return issues;
}

/* Calendar-year range rule (exchange semantics, e.g. Fugle historical < 1 year):
   2024-01-01~2024-12-31 is inside; exactly-one-year spans like
   2023-12-31~2024-12-31 or 2025-01-01~2026-01-01 are NOT.
   Assumes validated yyyy-MM-dd inputs with from <= to. */
export function isLessThanOneCalendarYear(from, to) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (ty - fy > 1) return false;
  if (ty - fy < 1) return true;
  if (tm !== fm) return tm < fm;
  return td < fd;
}

/* Deliverable 7 — transport failures map to stable domain errors. */
export function mapTransportStatus({ httpStatus = null, timeout = false, networkError = false, detail = null, retryAfterMs = null } = {}) {
  if (timeout === true) return new MarketDataError(DATA_ERROR_CODE.TIMEOUT, "provider 請求逾時", { detail });
  if (httpStatus === 401 || httpStatus === 403) return new MarketDataError(DATA_ERROR_CODE.AUTH_FAILED, `provider 認證失敗（HTTP ${httpStatus}）`, { httpStatus });
  if (httpStatus === 429) return new MarketDataError(DATA_ERROR_CODE.RATE_LIMITED, "provider 限流（HTTP 429）", { httpStatus, retryAfterMs: Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? Math.floor(retryAfterMs) : null });
  if (Number.isInteger(httpStatus) && httpStatus >= 500) return new MarketDataError(DATA_ERROR_CODE.PROVIDER_UNAVAILABLE, `provider 暫時不可用（HTTP ${httpStatus}）`, { httpStatus });
  if (networkError === true) return new MarketDataError(DATA_ERROR_CODE.PROVIDER_UNAVAILABLE, "provider 網路異常", { detail });
  if (Number.isInteger(httpStatus)) return new MarketDataError(DATA_ERROR_CODE.DATA_INVALID, `provider 回應異常（HTTP ${httpStatus}）`, { httpStatus });
  return new MarketDataError(DATA_ERROR_CODE.PROVIDER_UNAVAILABLE, "provider 未知傳輸失敗", { detail });
}

/* Deliverable 8 — retry classifier + bounded backoff. No infinite retry. */
const RETRYABLE = new Set([DATA_ERROR_CODE.RATE_LIMITED, DATA_ERROR_CODE.TIMEOUT, DATA_ERROR_CODE.PROVIDER_UNAVAILABLE]);

export function isRetryableCode(code) {
  return RETRYABLE.has(code);
}

export function computeBackoff(attempt, { baseDelayMs = 1000, maxDelayMs = 30_000, jitterMs = 0, random = Math.random } = {}) {
  const step = Math.max(1, Math.floor(attempt));
  const grown = baseDelayMs * 2 ** (step - 1);
  const ceiling = Math.max(0, maxDelayMs);
  return Math.floor(Math.min(Math.max(0, grown) + random() * Math.max(0, jitterMs), ceiling));
}

const MAX_ATTEMPTS_CEILING = 10;

export async function retryOperation(operation, { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 30_000, jitterMs = 0, random = Math.random, sleep = () => Promise.resolve(), shouldRetry = (error) => isRetryableCode(error?.code) } = {}) {
  const attempts = Math.min(Math.max(1, Math.floor(maxAttempts)), MAX_ATTEMPTS_CEILING);
  const ceiling = Math.max(0, maxDelayMs);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const value = await operation(attempt);
      return { ok: true, value, attempts: attempt };
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      // Server Retry-After wins over computed backoff, still under our hard ceiling.
      const serverHint = Number(error?.details?.retryAfterMs);
      const delay = Number.isFinite(serverHint) && serverHint >= 0
        ? Math.floor(Math.min(serverHint, ceiling))
        : computeBackoff(attempt, { baseDelayMs, maxDelayMs: ceiling, jitterMs, random });
      await sleep(delay);
    }
  }
  throw lastError;
}

/* Deliverable 9 — rate-limit awareness. Unknown stays unknown (UNVERIFIED, never guessed). */
export function parseRetryAfterMs(headers = {}, now = Date.now()) {
  const raw = headers["retry-after"] ?? headers["Retry-After"] ?? null;
  if (raw === null || raw === undefined) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.floor(seconds * 1000);
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.max(0, at - now);
  return null;
}

export function describeRateLimit({ known = false, retryAfterMs = null, remaining = null, resetAt = null } = {}) {
  return Object.freeze({
    known: known === true,
    retryAfterMs: Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? Math.floor(retryAfterMs) : null,
    remaining: Number.isInteger(remaining) && remaining >= 0 ? remaining : null,
    resetAt: Number.isFinite(resetAt) ? resetAt : null,
  });
}

/* Deliverable 10 — injected transport boundary. Adapters never touch global fetch. */
export function assertTransport(transport) {
  if (!transport || typeof transport.request !== "function") {
    fail(DATA_ERROR_CODE.DATA_INVALID, "transport 需要 request(op) 函式（injected，不可直連 global fetch）");
  }
  return transport;
}
