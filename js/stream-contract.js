/* Provider-neutral real-time streaming contract (Phase 7C, PR1: design + fake).
   No network, no secrets, no provider branching here: the future server bridge
   (Render trusted proxy -> Fugle WebSocket) and the browser transport (SSE)
   both speak these shapes. UI / research must never see raw provider frames.
   Official uphill reference (verified 2026-09-11, docs updated Jan 9 2026):
   developer.fugle.tw/docs/data/websocket-api/getting-started and
   .../market-data-channels/trades. Anything not in those pages is OUR policy,
   marked as such below. */
"use strict";

import {
  DATA_ERROR_CODE,
  DATA_KINDS,
  FRESHNESS,
  MarketDataError,
  NORMALIZATION_VERSION,
  computeBackoff,
  evaluateFreshness,
} from "./market-data-contract.js";

/* Stream lifecycle. Heartbeat proves CONNECTION alive; only market events
   (providerTimestamp) prove DATA fresh — the two are tracked separately. */
export const STREAM_STATES = Object.freeze({
  IDLE: "IDLE",
  CONNECTING: "CONNECTING",
  AUTHENTICATING: "AUTHENTICATING",
  SUBSCRIBING: "SUBSCRIBING",
  LIVE: "LIVE",
  STALE: "STALE",
  RECONNECTING: "RECONNECTING",
  FAILED: "FAILED",
  CLOSED: "CLOSED",
});

const TRANSITIONS = Object.freeze({
  [STREAM_STATES.IDLE]: [STREAM_STATES.CONNECTING],
  [STREAM_STATES.CONNECTING]: [STREAM_STATES.AUTHENTICATING, STREAM_STATES.FAILED, STREAM_STATES.CLOSED],
  [STREAM_STATES.AUTHENTICATING]: [STREAM_STATES.SUBSCRIBING, STREAM_STATES.FAILED, STREAM_STATES.CLOSED],
  [STREAM_STATES.SUBSCRIBING]: [STREAM_STATES.LIVE, STREAM_STATES.FAILED, STREAM_STATES.CLOSED],
  [STREAM_STATES.LIVE]: [STREAM_STATES.STALE, STREAM_STATES.RECONNECTING, STREAM_STATES.CLOSED, STREAM_STATES.FAILED],
  [STREAM_STATES.STALE]: [STREAM_STATES.LIVE, STREAM_STATES.RECONNECTING, STREAM_STATES.CLOSED, STREAM_STATES.FAILED],
  [STREAM_STATES.RECONNECTING]: [STREAM_STATES.CONNECTING, STREAM_STATES.FAILED, STREAM_STATES.CLOSED],
  [STREAM_STATES.FAILED]: [STREAM_STATES.CLOSED, STREAM_STATES.CONNECTING],
  [STREAM_STATES.CLOSED]: [],
});

export function assertStreamTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new StreamError(
      STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID,
      `非法 stream 轉移：${from} → ${to}`,
      { from, to },
    );
  }
  return to;
}

export const STREAM_CHANNELS = Object.freeze({
  TRADES: "trades",
  CANDLES: "candles",
  BOOKS: "books",
  AGGREGATES: "aggregates",
  INDICES: "indices",
});

export const STREAM_ERROR_CODE = Object.freeze({
  STREAM_AUTH_FAILED: "STREAM_AUTH_FAILED",
  STREAM_SUBSCRIBE_FAILED: "STREAM_SUBSCRIBE_FAILED",
  STREAM_UPSTREAM_CLOSED: "STREAM_UPSTREAM_CLOSED",
  STREAM_TIMEOUT: "STREAM_TIMEOUT",
  STREAM_RATE_LIMITED: "STREAM_RATE_LIMITED",
  STREAM_SCHEMA_INVALID: "STREAM_SCHEMA_INVALID",
  STREAM_RECONNECT_EXHAUSTED: "STREAM_RECONNECT_EXHAUSTED",
});

export class StreamError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "StreamError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new StreamError(code, message, details);
}

/* Classify one raw upstream frame by shape only (never logs, never mutates).
   Fugle frame kinds per official docs: authenticated / error / subscribed /
   data / heartbeat / pong. Anything else is 'unknown', never an exception. */
export function classifyUpstreamFrame(frame) {
  if (!frame || typeof frame !== "object") return "malformed";
  const { event, data } = frame;
  if (event === "authenticated") return "auth-ok";
  if (event === "subscribed") return "subscribed";
  if (event === "heartbeat") return "heartbeat";
  if (event === "pong") return "pong";
  if (event === "data") return "data";
  if (event === "error") {
    const message = String(data?.message ?? "");
    return /invalid authentication/i.test(message) ? "auth-error" : "upstream-error";
  }
  return "unknown";
}

/* Normalized stream event envelope. dataKind is always realtime; freshness is
   evaluated from the MARKET event timestamp (never from heartbeat arrival).
   serial (Fugle "流水號") may be null when the provider omits it. */
export function normalizeStreamEvent(
  event,
  { provider, market = null, symbol, channel, providerTimestamp, receivedAt = null, source = "unknown", sessionId = null, isTrial = false, now = Date.now() } = {},
) {
  if (typeof provider !== "string" || !provider) fail(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, "stream event 需要 provider");
  if (typeof symbol !== "string" || !symbol) fail(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, "stream event 需要 symbol");
  if (!Object.values(STREAM_CHANNELS).includes(channel)) fail(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, `未知 stream channel：${channel}`);
  if (!Number.isFinite(providerTimestamp)) fail(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, `stream event 缺有效 providerTimestamp（${symbol}/${channel}）`);
  if (!event || typeof event !== "object") fail(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, "stream event payload 不是物件");
  const freshness = evaluateFreshness({ providerTimestamp, receivedAt, now, dataKind: DATA_KINDS.REALTIME });
  const serial = Number.isFinite(event.serial) ? event.serial : null;
  return Object.freeze({
    data: Object.freeze({ ...event }),
    meta: Object.freeze({
      provider,
      market,
      symbol,
      channel,
      dataKind: DATA_KINDS.REALTIME,
      source,
      providerTimestamp,
      receivedAt: Number.isFinite(receivedAt) ? receivedAt : null,
      freshnessMs: freshness.ageMs,
      stale: freshness.status === FRESHNESS.STALE,
      freshnessStatus: freshness.status,
      sequence: serial,
      isTrial: isTrial === true,
      normalizationVersion: NORMALIZATION_VERSION,
      sessionId,
    }),
  });
}

/* Per (channel, symbol) serial ordering. Providers may restart serials, so a
   restarted (lower) serial after a gap is 'out-of-order', never silently ok. */
export function checkSequence(lastSerial, serial) {
  if (!Number.isFinite(serial)) return { status: "no-sequence" };
  if (!Number.isFinite(lastSerial)) return { status: "ok" };
  if (serial === lastSerial) return { status: "duplicate" };
  if (serial < lastSerial) return { status: "out-of-order" };
  if (serial > lastSerial + 1) return { status: "gap", missing: serial - lastSerial - 1 };
  return { status: "ok" };
}

/* Stale policy (OURS, not Fugle's): no market event for staleAfterMs while the
   connection may still be alive (heartbeats keep flowing). Default 60s = 2x
   the official 30s heartbeat interval, so one missed heartbeat never flips. */
export const DEFAULT_STREAM_STALE_AFTER_MS = 60_000;

export function isStreamStale({ lastEventAt = null, now = Date.now(), staleAfterMs = DEFAULT_STREAM_STALE_AFTER_MS } = {}) {
  if (!Number.isFinite(lastEventAt)) return true;
  return now - lastEventAt > staleAfterMs;
}

/* Bounded reconnect (OURS): exponential backoff via the shared contract
   helper, hard max attempts, then FAILED — never while(true). */
export const DEFAULT_STREAM_RECONNECT = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
});

export function planReconnect(attempt, { maxAttempts = DEFAULT_STREAM_RECONNECT.maxAttempts, baseDelayMs = DEFAULT_STREAM_RECONNECT.baseDelayMs, maxDelayMs = DEFAULT_STREAM_RECONNECT.maxDelayMs } = {}) {
  const n = Math.max(1, Math.floor(attempt));
  if (n > Math.max(1, Math.floor(maxAttempts))) {
    throw new StreamError(STREAM_ERROR_CODE.STREAM_RECONNECT_EXHAUSTED, `重連次數用盡（上限 ${maxAttempts}）`, { attempt: n, maxAttempts });
  }
  return Object.freeze({
    action: "retry",
    attempt: n,
    delayMs: computeBackoff(n, { baseDelayMs, maxDelayMs, jitterMs: 0, random: () => 0 }),
  });
}

const SECRET_KEY_PATTERN = /apikey|api_key|api-key|authorization|[^a-z]token[^a-z]?|^token$|password|secret|credential/i;

/* Log-safe copy: removes provider-secret-shaped keys at any depth,
   cycle-safe. Auth frames must pass through here before any logger. */
export function redactForLog(value, seen = new Set()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value.map((item) => redactForLog(item, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const copy = {};
    for (const [key, item] of Object.entries(value)) {
      copy[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactForLog(item, seen);
    }
    return copy;
  }
  return value;
}

/* Provider error frame -> stable domain code. Auth-shaped failures stay
   distinct from subscribe failures so UI never guesses from strings. */
export function mapUpstreamError(frame) {
  const kind = classifyUpstreamFrame(frame);
  if (kind === "auth-error") return new StreamError(STREAM_ERROR_CODE.STREAM_AUTH_FAILED, "upstream 認證失敗", { event: frame?.event ?? null });
  if (kind === "upstream-error") return new StreamError(STREAM_ERROR_CODE.STREAM_SUBSCRIBE_FAILED, `upstream 錯誤：${frame?.data?.message ?? "unknown"}`, { event: frame?.event ?? null });
  if (kind === "malformed" || kind === "unknown") {
    return new StreamError(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, `無法識別的 upstream frame：${kind}`, { event: frame?.event ?? null });
  }
  return new StreamError(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, `非錯誤 frame 不可轉錯誤碼：${kind}`, { kind });
}

export { DATA_ERROR_CODE, FRESHNESS };
