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
import { STREAM_CHANNELS } from "../js/stream-contract.js";
import { DEFAULT_SSE_KEEPALIVE_MS, SSE_HEADERS, createSseSink, formatRetryHint } from "./stream-sse.js";

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

/* Anti-abuse (Track A2 / R-024):
   - per-client token bucket（不是全 process 共用），單一來源打爆只影響自己；
   - 每日上游呼叫預算（per process），避免單一故障或濫用燒完 Fugle 額度；
   - quote 短 TTL 快取，同代碼在 TTL 內只打一次上游。
   仍是 single-process（不是 distributed），見 ADR-006。 */
const DEFAULT_RATE_LIMIT = Object.freeze({ capacity: 60, refillPerSecond: 1 });
const DEFAULT_QUOTE_CACHE_TTL_MS = 4_000;
const DEFAULT_DAILY_UPSTREAM_BUDGET = 5_000;
const MAX_CLIENT_BUCKETS = 10_000;

/* rateLimit 支援兩種形狀：
   - 新版 token bucket：{ capacity, refillPerSecond }
   - 舊版滑動視窗：{ maxRequests, windowMs }（自動換算成等價 token bucket） */
function normalizeRateLimit(opt) {
  if (opt === false) return null;
  if (opt === undefined || opt === null) return { ...DEFAULT_RATE_LIMIT };
  if (Number.isFinite(opt.capacity) && opt.capacity > 0 && Number.isFinite(opt.refillPerSecond) && opt.refillPerSecond > 0) {
    return { capacity: opt.capacity, refillPerSecond: opt.refillPerSecond };
  }
  const maxRequests = Number.isInteger(opt.maxRequests) && opt.maxRequests > 0 ? opt.maxRequests : DEFAULT_RATE_LIMIT.capacity;
  const windowMs = Number.isFinite(opt.windowMs) && opt.windowMs > 0 ? opt.windowMs : 60_000;
  return { capacity: maxRequests, refillPerSecond: (maxRequests * 1000) / windowMs };
}

/* 信任邊界：只有明確設定 TRUST_PROXY=1（proxy 部署在 Render／反向代理後方）
   才採用 X-Forwarded-For 的第一段；否則只看 socket 遠端位址，不信任任何
   任意客戶端可偽造的 header。 */
export function resolveClientKey(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const headers = req?.headers ?? {};
    const raw = Object.entries(headers).find(([name]) => name.toLowerCase() === "x-forwarded-for")?.[1];
    const first = typeof raw === "string" ? raw.split(",")[0]?.trim() : null;
    if (first) return first;
  }
  return req?.socket?.remoteAddress ?? "unknown-client";
}

/* 只留雜湊後的 client id 進 log：不記 IP、不記任何 key。 */
export function clientIdOf(clientKey) {
  return crypto.createHash("sha256").update(String(clientKey)).digest("hex").slice(0, 12);
}

/* Token bucket：回傳 null 代表放行；回傳秒數代表要 shed。 */
function takeToken(state, clientKey) {
  const rl = state.rateLimit;
  if (!rl) return null;
  const now = state.clock();
  let bucket = state.buckets.get(clientKey);
  if (!bucket) {
    bucket = { tokens: rl.capacity, updatedAt: now };
    state.buckets.set(clientKey, bucket);
    evictStaleBuckets(state);
  }
  const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(rl.capacity, bucket.tokens + elapsedSeconds * rl.refillPerSecond);
  bucket.updatedAt = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return null;
  }
  return Math.max(1, Math.ceil((1 - bucket.tokens) / rl.refillPerSecond));
}

/* bucket 表不可無限成長（大量來源 IP 會撐大記憶體）：超過上限就丟最舊的。 */
function evictStaleBuckets(state) {
  if (state.buckets.size <= MAX_CLIENT_BUCKETS) return;
  const entries = [...state.buckets.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  for (const [key] of entries) {
    if (state.buckets.size <= MAX_CLIENT_BUCKETS) break;
    state.buckets.delete(key);
  }
}

/* 每日上游呼叫預算（UTC 日界）。超過 → RATE_LIMITED，不打上游。 */
function consumeUpstreamBudget(state) {
  const budget = state.dailyUpstreamBudget;
  if (!budget) return { allowed: true, used: 0, budget };
  const day = new Date(state.clock()).toISOString().slice(0, 10);
  if (state.budgetDay !== day) {
    state.budgetDay = day;
    state.budgetUsed = 0;
  }
  if (state.budgetUsed >= budget) return { allowed: false, used: state.budgetUsed, budget };
  state.budgetUsed += 1;
  return { allowed: true, used: state.budgetUsed, budget };
}

export function createProxy({
  apiKey = process.env.FUGLE_API_KEY ?? "",
  fetchImpl = null,
  clock = () => Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  sleep = null,
  logger = null,
  rateLimit = null,
  streamManager = null,
  sseKeepaliveMs = DEFAULT_SSE_KEEPALIVE_MS,
  trustProxy = process.env.TRUST_PROXY === "1",
  quoteCacheTtlMs = DEFAULT_QUOTE_CACHE_TTL_MS,
  dailyUpstreamBudget = DEFAULT_DAILY_UPSTREAM_BUDGET,
} = {}) {
  const state = {
    apiKey,
    fetchImpl: fetchImpl ?? globalThis.fetch?.bind(globalThis) ?? null,
    clock,
    timeoutMs,
    maxAttempts,
    sleep: sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    log: logger ?? (() => {}),
    rateLimit: normalizeRateLimit(rateLimit),
    buckets: new Map(),
    quoteCache: new Map(),
    quoteCacheTtlMs,
    dailyUpstreamBudget,
    budgetDay: null,
    budgetUsed: 0,
    trustProxy,
    streamManager,
    sseKeepaliveMs,
  };

  async function handler(req, res) {
    /* latency 用注入的 clock（測試可注入），不再用 Date.now()。 */
    res.__proxyClock = state.clock;
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
      if (url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "application/json", ...cors });
        res.end(JSON.stringify({ status: "ok", service: "market-proxy" }));
        return;
      }
      const clientKey = resolveClientKey(req, { trustProxy: state.trustProxy });
      const clientId = clientIdOf(clientKey);
      res.__proxyClientId = clientId;
      if (url.pathname === "/api/market/quote") {
        const symbol = assertSymbol(url.searchParams.get("symbol"));
        const shed = takeToken(state, clientKey);
        if (shed) return send(req, res, cors, 429, "RATE_LIMITED", "你的來源請求過於頻繁，請稍後再試（per-client 保護）", requestId, started, 0, { "retry-after": shed });
        return await serveQuote(state, cors, req, res, symbol, requestId, started, clientId);
      }
      if (url.pathname === "/api/market/bars") {
        const symbol = assertSymbol(url.searchParams.get("symbol"));
        const range = assertRange(url.searchParams.get("from"), url.searchParams.get("to"));
        const shed = takeToken(state, clientKey);
        if (shed) return send(req, res, cors, 429, "RATE_LIMITED", "你的來源請求過於頻繁，請稍後再試（per-client 保護）", requestId, started, 0, { "retry-after": shed });
        return await serveBars(state, cors, req, res, symbol, range, requestId, started);
      }
      if (url.pathname === "/api/market/stream") {
        const symbol = assertSymbol(url.searchParams.get("symbol"));
        const shed = takeToken(state, clientKey);
        if (shed) return send(req, res, cors, 429, "RATE_LIMITED", "你的來源請求過於頻繁，請稍後再試（per-client 保護）", requestId, started, 0, { "retry-after": shed });
        return serveStream(state, cors, req, res, symbol, requestId, started, clientId);
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

/* Quote 短 TTL 快取（Track A2 / R-024）：同代碼在 TTL 內只打一次上游，
   cache 命中時 meta.cached=true 且帶 cacheAgeMs；資料本身不變（新舊相同）。 */
function readQuoteCache(state, symbol) {
  const entry = state.quoteCache.get(symbol);
  if (!entry) return null;
  const age = state.clock() - entry.storedAt;
  if (age > state.quoteCacheTtlMs) {
    state.quoteCache.delete(symbol);
    return null;
  }
  return { ...entry, age };
}

function writeQuoteCache(state, symbol, entry) {
  state.quoteCache.set(symbol, entry);
  if (state.quoteCache.size > 200) {
    const oldest = [...state.quoteCache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0];
    if (oldest) state.quoteCache.delete(oldest[0]);
  }
}

async function serveQuote(state, cors, req, res, symbol, requestId, started, clientId) {
  const cached = readQuoteCache(state, symbol);
  if (cached) {
    const meta = metaFor(state, {
      symbol, market: cached.market, dataKind: DATA_KINDS.REALTIME,
      providerTimestamp: cached.data.timestamp, source: "fugle-quote",
      requestId, pointInTime: "unknown", adjustmentMode: "unknown",
    });
    meta.cached = true;
    meta.cacheAgeMs = cached.age;
    meta.receivedAt = cached.receivedAt;
    return sendOk(req, res, cors, { data: cached.data, meta }, requestId, started, 0);
  }
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
  writeQuoteCache(state, symbol, {
    data: normalized,
    market: mapped.market,
    receivedAt: envelope.meta.receivedAt,
    storedAt: state.clock(),
  });
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

/* SSE stream route: one long-lived response per browser client, fanned out
   from a single shared upstream per subscription key (see
   server/fugle-stream-manager.js). v1 fixes channel=trades server-side;
   symbol accepts any Fugle-resolvable TW code (incl. PR #26 runtimeSymbol). */
function serveStream(state, cors, req, res, symbol, requestId, started, clientId) {
  if (!state.streamManager) {
    return send(req, res, cors, 503, "PROVIDER_UNAVAILABLE", "stream bridge 未啟用", requestId, started);
  }
  res.writeHead(200, { ...SSE_HEADERS, ...cors });
  res.write(formatRetryHint());
  let client = null;
  let keepalive = null;
  const stopKeepalive = () => {
    if (keepalive !== null) {
      try { clearInterval(keepalive); } catch { /* already cleared */ }
      keepalive = null;
    }
  };
  const sink = createSseSink(res, {
    onGone: () => {
      stopKeepalive();
      if (client) state.streamManager.detach(client);
      state.log({ requestId, route: "/api/market/stream", symbol, status: "gone", domainCode: "SSE_CLIENT_GONE", latencyMs: state.clock() - started, attempts: 0 });
    },
  });
  client = {
    sendState: (s) => sink.sendState(s),
    sendTrade: (envelope, sequenceStatus) => {
      const ok = sink.sendTrade(envelope, sequenceStatus);
      if (!ok) {
        // Slow-client policy: drop this client only; fan-out continues.
        state.log({ requestId, route: "/api/market/stream", symbol, status: "dropped", domainCode: "SSE_SLOW_CLIENT", latencyMs: state.clock() - started, attempts: 0 });
        state.streamManager.detach(client);
        sink.close();
      }
      return ok;
    },
    sendError: (code, message) => sink.sendError(code, message),
    close: () => sink.close(),
  };
  try {
    state.streamManager.subscribe(symbol, STREAM_CHANNELS.TRADES, client, { clientId });
  } catch (error) {
    stopKeepalive();
    const code = error?.code ?? "PROVIDER_UNAVAILABLE";
    const http = code === "STREAM_RATE_LIMITED" ? 429 : code === "INVALID_SYMBOL" ? 404 : 502;
    try { sink.sendError(code, error?.message ?? code); } catch { /* sink dead */ }
    state.log({ requestId, route: "/api/market/stream", symbol, status: http, domainCode: code, latencyMs: state.clock() - started, attempts: 0 });
    return;
  }
  state.log({ requestId, route: "/api/market/stream", symbol, status: 200, domainCode: "SSE_ATTACHED", latencyMs: state.clock() - started, attempts: 0 });
  keepalive = setInterval(() => {
    if (!sink.keepalive()) {
      stopKeepalive();
      state.streamManager.detach(client);
      sink.close();
    }
  }, state.sseKeepaliveMs);
  keepalive.unref?.();
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
        const budget = consumeUpstreamBudget(state);
        if (!budget.allowed) {
          throw new MarketDataError("RATE_LIMITED", `今日上游呼叫預算已用盡（${budget.budget} 次／日），請稍後再試`, { upstreamBudgetExhausted: true });
        }
        return fetchUpstream(state, path);
      },
      { maxAttempts: state.maxAttempts, sleep: state.sleep, shouldRetry: (e) => isRetryableCode(e?.code) && e?.details?.upstreamBudgetExhausted !== true },
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
  let raceTimer = null;
  const timeoutRace = new Promise((_, reject) => {
    raceTimer = setTimeout(() => {
      controller.abort();
      reject(timeoutError());
    }, state.timeoutMs);
    raceTimer.unref?.();
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
    /* 兩個逾時計時器都要清：漏掉會讓 process 抓到逾時 handle（F-14）。 */
    clearTimeout(timer);
    if (raceTimer) clearTimeout(raceTimer);
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
    const clock = typeof res?.__proxyClock === "function" ? res.__proxyClock : Date.now;
    res.__proxyLog = {
      requestId,
      route: url.pathname,
      symbol: url.searchParams.get("symbol"),
      status: http,
      domainCode: code,
      latencyMs: clock() - started,
      attempts,
      clientId: res?.__proxyClientId ?? null,
    };
  } catch {
    res.__proxyLog = { requestId, route: "unknown", symbol: null, status: http, domainCode: code, latencyMs: null, attempts, clientId: res?.__proxyClientId ?? null };
  }
}

/* Entrypoint moved to server/start-market-proxy.js (fail-fast config + graceful shutdown). */
