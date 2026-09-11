/* Trusted market-data proxy: Browser → this process → Fugle REST.
   Deploy-neutral plain Node 24 http (no express/cors/axios/uuid/retry deps).
   Hard rules:
   - FUGLE_API_KEY only from process env, never logged, never forwarded to browser.
   - Fixed upstream host + fixed Fugle paths (no open proxy: no upstream URL params).
   - GET only; CORS allowlist (Pages + localhost), never "*".
   - Every upstream call: AbortController hard timeout + 7A retryOperation.
   - Logs carry requestId/route/symbol/status/domainCode/latency/attempts only. */
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  DATA_ERROR_CODE,
  DATA_KINDS,
  NORMALIZATION_VERSION,
  MarketDataError,
  evaluateFreshness,
  isLessThanOneCalendarYear,
  isRetryableCode,
  mapTransportStatus,
  normalizeBars,
  normalizeQuote,
  parseRetryAfterMs,
  retryOperation,
} from "../js/market-data-contract.js";
import { FUGLE_MARKET_MAP, FUGLE_PROVIDER_ID, mapFugleBars, mapFugleQuote } from "../js/providers/fugle-mapper.js";

const FUGLE_BASE = "https://api.fugle.tw";
const FUGLE_REST = `${FUGLE_BASE}/marketdata/v1.0/stock`;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 3;

const ALLOWED_ORIGINS = Object.freeze([
  /^https:\/\/waydefu\.github\.io$/,
  /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/,
]);

const SYMBOL_PATTERN = /^[A-Za-z0-9]{4,6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/* Prototype-grade anti-abuse: per-process sliding window (NOT distributed,
   NOT production-grade — see ADR-006). Default on with a conservative budget;
   pass rateLimit: false only in tests or behind platform protection. */
const DEFAULT_RATE_LIMIT = Object.freeze({ maxRequests: 120, windowMs: 60_000 });

function normalizeRateLimit(opt) {
  if (opt === false) return null;
  if (opt === undefined || opt === null) return { ...DEFAULT_RATE_LIMIT };
  return {
    maxRequests: Number.isInteger(opt.maxRequests) && opt.maxRequests > 0 ? opt.maxRequests : DEFAULT_RATE_LIMIT.maxRequests,
    windowMs: Number.isFinite(opt.windowMs) && opt.windowMs > 0 ? opt.windowMs : DEFAULT_RATE_LIMIT.windowMs,
  };
}

/* Returns retry-after seconds when shedding, null when allowed. */
function shedLoad(state) {
  const rl = state.rateLimit;
  if (!rl) return null;
  const now = state.clock();
  state.hits = state.hits.filter((t) => now - t < rl.windowMs);
  if (state.hits.length >= rl.maxRequests) return Math.max(1, Math.ceil(rl.windowMs / 1000));
  state.hits.push(now);
  return null;
}

export function createProxy({ apiKey = process.env.FUGLE_API_KEY ?? "", fetchImpl = null, clock = () => Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS, maxAttempts = DEFAULT_MAX_ATTEMPTS, sleep = null, logger = null, rateLimit = null } = {}) {
  const state = {
    apiKey,
    fetchImpl: fetchImpl ?? globalThis.fetch?.bind(globalThis) ?? null,
    clock,
    timeoutMs,
    maxAttempts,
    sleep: sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    log: logger ?? (() => {}),
    rateLimit: normalizeRateLimit(rateLimit),
    hits: [],
  };

  async function handler(req, res) {
    await route(req, res);
    if (res.__proxyLog) state.log(res.__proxyLog);
  }

  async function route(req, res) {
    const started = state.clock();
    const requestId = crypto.randomUUID();
    const origin = req.headers?.origin ?? null;
    const cors = corsHeaders(origin);
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, { ...cors, "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "Content-Type" });
        res.end();
        return;
      }
      if (req.method !== "GET") return send(req, res, cors, 405, "UNSUPPORTED_CAPABILITY", "只支援 GET", requestId, started);
      const url = new URL(req.url ?? "/", "http://proxy.local");
      if (url.pathname === "/api/market/quote") {
        const symbol = assertSymbol(url.searchParams.get("symbol"));
        const shed = shedLoad(state);
        if (shed) return send(req, res, cors, 429, "RATE_LIMITED", "proxy 繁忙，請稍後再試（prototype 級保護）", requestId, started, 0, { "retry-after": shed });
        return await serveQuote(state, cors, req, res, symbol, requestId, started);
      }
      if (url.pathname === "/api/market/bars") {
        const symbol = assertSymbol(url.searchParams.get("symbol"));
        const range = assertRange(url.searchParams.get("from"), url.searchParams.get("to"));
        const shed = shedLoad(state);
        if (shed) return send(req, res, cors, 429, "RATE_LIMITED", "proxy 繁忙，請稍後再試（prototype 級保護）", requestId, started, 0, { "retry-after": shed });
        return await serveBars(state, cors, req, res, symbol, range, requestId, started);
      }
      return send(req, res, cors, 404, "UNSUPPORTED_CAPABILITY", "未知路由（open proxy 不存在）", requestId, started);
    } catch (error) {
      if (error instanceof MarketDataError && error.details?.http !== undefined) {
        return send(req, res, cors, error.details.http, error.code, error.message, requestId, started);
      }
      if (error instanceof MarketDataError) {
        return send(req, res, cors, 400, error.code, error.message, requestId, started);
      }
      return send(req, res, cors, 500, "PROVIDER_UNAVAILABLE", "proxy 內部錯誤", requestId, started);
    }
  }

  async function start(port = 0, host = "127.0.0.1") {
    const server = http.createServer((req, res) => {
      handler(req, res).catch(() => {
        try { res.writeHead(500, { "content-type": "application/json" }); res.end("{}"); } catch { /* socket gone */ }
      });
    });
    await new Promise((resolve) => server.listen(port, host, resolve));
    const address = server.address();
    const url = `http://${address.address}:${address.port}`;
    return {
      server,
      port: address.port,
      url,
      close: () => new Promise((resolve) => server.close(resolve)),
    };
  }

  return { handler, start };
}

function corsHeaders(origin) {
  if (typeof origin === "string" && ALLOWED_ORIGINS.some((re) => re.test(origin))) {
    return { "access-control-allow-origin": origin, vary: "Origin" };
  }
  return {};
}

function assertSymbol(symbol) {
  if (typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol)) {
    throw inputError(400, "INVALID_SYMBOL", `symbol 格式不正確：${symbol}`);
  }
  return symbol.toUpperCase();
}

function assertRange(from, to) {
  if (typeof from !== "string" || typeof to !== "string" || !DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
    throw inputError(400, "DATA_INVALID", `歷史區間不合法：${from} ~ ${to}`);
  }
  if (!isLessThanOneCalendarYear(from, to)) {
    throw inputError(400, "DATA_INVALID", "歷史區間需小於 1 日曆年（Fugle 官方限制：恰滿 1 年亦拒絕）");
  }
  return { from, to };
}

function inputError(http, code, message) {
  return new MarketDataError(code, message, { http });
}

async function serveQuote(state, cors, req, res, symbol, requestId, started) {
  const outcome = await upstream(state, `/intraday/quote/${encodeURIComponent(symbol)}`, symbol, requestId, started, "fugle-quote");
  if (!outcome.ok) return send(req, res, cors, outcome.http, outcome.code, outcome.message, requestId, started, outcome.attempts);
  let mapped;
  try {
    mapped = mapFugleQuote(outcome.payload);
  } catch (error) {
    throw inputError(502, error?.code ?? "DATA_INVALID", error?.message ?? "Fugle quote 結構異常");
  }
  const normalized = normalizeQuote(mapped, { market: mapped.market });
  const envelope = {
    data: normalized,
    meta: metaFor(state, { symbol, market: mapped.market, dataKind: DATA_KINDS.REALTIME, providerTimestamp: normalized.timestamp, source: "fugle-quote", requestId, pointInTime: "unknown", adjustmentMode: "unknown" }),
  };
  return sendOk(req, res, cors, envelope, requestId, started, outcome.attempts);
}

async function serveBars(state, cors, req, res, symbol, range, requestId, started) {
  const query = `?from=${range.from}&to=${range.to}&timeframe=D&fields=open,high,low,close,volume,change&sort=asc`;
  const outcome = await upstream(state, `/historical/candles/${encodeURIComponent(symbol)}${query}`, symbol, requestId, started, "fugle-bars");
  if (!outcome.ok) return send(req, res, cors, outcome.http, outcome.code, outcome.message, requestId, started, outcome.attempts);
  let mapped;
  try {
    mapped = mapFugleBars(outcome.payload);
  } catch (error) {
    throw inputError(502, error?.code ?? "DATA_INVALID", error?.message ?? "Fugle candles 結構異常");
  }
  const market = FUGLE_MARKET_MAP[outcome.payload?.market] ?? null;
  const normalized = mapped.bars;
  const envelope = {
    data: normalized,
    meta: metaFor(state, {
      symbol, market, dataKind: DATA_KINDS.HISTORICAL,
      providerTimestamp: normalized.length ? normalized[normalized.length - 1].t : null,
      source: "fugle-bars", requestId, pointInTime: "unknown",
      adjustmentMode: outcome.payload?.adjusted === true ? "adjusted" : "unadjusted",
    }),
  };
  return sendOk(req, res, cors, envelope, requestId, started, outcome.attempts);
}

function metaFor(state, { symbol, market, dataKind, providerTimestamp, source, requestId, pointInTime, adjustmentMode }) {
  const receivedAt = state.clock();
  const freshness = evaluateFreshness({ providerTimestamp, receivedAt, now: receivedAt, dataKind });
  return {
    provider: FUGLE_PROVIDER_ID, market, symbol, dataKind, providerTimestamp: providerTimestamp ?? null,
    receivedAt, freshnessMs: freshness.ageMs, stale: freshness.status === "STALE", freshnessStatus: freshness.status,
    source, requestId,
    cached: false, normalizationVersion: NORMALIZATION_VERSION, pointInTime, adjustmentMode,
  };
}

async function upstream(state, path, symbol, requestId, started, route) {
  if (!state.apiKey) {
    return { ok: false, http: 503, code: "AUTH_REQUIRED", message: "proxy 未設定 FUGLE_API_KEY（fail closed）", attempts: 0 };
  }
  if (!state.fetchImpl) {
    return { ok: false, http: 502, code: "PROVIDER_UNAVAILABLE", message: "無可用 upstream transport", attempts: 0 };
  }
  let attempts = 0;
  try {
    const payload = await retryOperation(
      async (attempt) => {
        attempts = attempt;
        return fetchUpstream(state, path);
      },
      { maxAttempts: state.maxAttempts, sleep: state.sleep, shouldRetry: (e) => isRetryableCode(e?.code) },
    );
    return { ok: true, payload: payload.value, attempts };
  } catch (error) {
    if (!(error instanceof MarketDataError)) {
      return { ok: false, http: 502, code: "PROVIDER_UNAVAILABLE", message: "upstream 未知失敗", attempts };
    }
    if (error.code === "INVALID_SYMBOL") return { ok: false, http: 404, code: error.code, message: error.message, attempts };
    if (error.code === "RATE_LIMITED") return { ok: false, http: 429, code: error.code, message: error.message, attempts };
    if (error.code === "TIMEOUT") return { ok: false, http: 504, code: error.code, message: error.message, attempts };
    if (error.code === "AUTH_FAILED") return { ok: false, http: 502, code: error.code, message: error.message, attempts };
    return { ok: false, http: 502, code: error.code, message: error.message, attempts };
  }
}

async function fetchUpstream(state, path) {
  const controller = new AbortController();
  const timeoutError = () => {
    const error = new Error(`upstream 逾時（${state.timeoutMs}ms）`);
    error.name = "TimeoutError";
    return error;
  };
  const timer = setTimeout(() => controller.abort(), state.timeoutMs);
  timer.unref?.();
  const timeoutRace = new Promise((_, reject) => {
    const t = setTimeout(() => {
      controller.abort();
      reject(timeoutError());
    }, state.timeoutMs);
    t.unref?.();
  });
  try {
    const response = await Promise.race([
      state.fetchImpl(`${FUGLE_REST}${path}`, {
        method: "GET",
        headers: { "X-API-KEY": state.apiKey },
        signal: controller.signal,
      }),
      timeoutRace,
    ]);
    const retryAfterMs = parseRetryAfterMs({ "retry-after": response.headers?.get?.("retry-after") }, state.clock());
    if (response.status === 404) throw new MarketDataError("INVALID_SYMBOL", "Fugle 查無此商品代碼");
    if (!response.ok) throw withRetryHint(mapTransportStatus({ httpStatus: response.status, retryAfterMs }), retryAfterMs);
    const payload = await safeJson(response);
    if (!payload || typeof payload !== "object") throw new MarketDataError("DATA_INVALID", "Fugle 回應非 JSON 物件");
    return payload;
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError") throw new MarketDataError("TIMEOUT", `upstream 逾時（${state.timeoutMs}ms）`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function withRetryHint(error, retryAfterMs) {
  if (error?.code === "RATE_LIMITED" && Number.isFinite(retryAfterMs)) {
    error.details = { ...(error.details ?? {}), retryAfterMs };
  }
  return error;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function send(req, res, cors, http, code, message, requestId, started, attempts = 0, extraHeaders = {}) {
  state_log(req, res, { requestId, http, code, started, attempts });
  res.writeHead(http, { "content-type": "application/json", ...cors, ...extraHeaders });
  res.end(JSON.stringify({ error: { code, message, requestId } }));
}

function sendOk(req, res, cors, envelope, requestId, started, attempts) {
  state_log(req, res, { requestId, http: 200, code: "OK", started, attempts });
  res.writeHead(200, { "content-type": "application/json", ...cors });
  res.end(JSON.stringify(envelope));
}

function state_log(req, res, { requestId, http, code, started, attempts }) {
  try {
    const url = new URL(req?.url ?? "/", "http://proxy.local");
    res.__proxyLog = {
      requestId,
      route: url.pathname,
      symbol: url.searchParams.get("symbol"),
      status: http,
      domainCode: code,
      latencyMs: Date.now() - started,
      attempts,
    };
  } catch {
    res.__proxyLog = { requestId, route: "unknown", symbol: null, status: http, domainCode: code, latencyMs: null, attempts };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  const { start } = createProxy({
    logger: (entry) => {
      console.log(JSON.stringify({ ...entry, at: new Date().toISOString() }));
    },
  });
  start(port).then(({ url }) => {
    console.log(`market-proxy listening on ${url} (FUGLE_API_KEY ${process.env.FUGLE_API_KEY ? "set" : "MISSING"})`);
  });
}
