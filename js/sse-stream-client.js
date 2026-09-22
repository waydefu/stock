/* Provider-neutral browser SSE stream client (Phase 7C PR3).
   Talks ONLY to the trusted proxy origin
   (`<baseUrl>/api/market/stream?symbol=`); it never knows the upstream
   host, never holds a key, never logs payloads. Three disjoint livenesses
   (SSE semantic hardening):
   - transport: this EventSource (CONNECTING/OPEN/RECONNECTING/CLOSED/FAILED)
   - upstream: last server `state` event (IDLE/CONNECTING/AUTHENTICATING/
     SUBSCRIBING/LIVE/...) owned by the server bridge, not by us
   - market freshness: last `trade` meta (server-evaluated) + local
     no-trade watchdog; EventSource OPEN never implies FRESH data.
   Native EventSource auto-reconnect (server `retry:` hint) is the ONLY
   browser retry path: this client implements no timer of its own.
   Generation guard: every start/switch/stop retires the previous stream;
   late frames from a retired generation are dropped and counted, never
   delivered (symbol cross-contamination is a drop, not a render). */
"use strict";

import {
  DEFAULT_STREAM_STALE_AFTER_MS,
  STREAM_STATES,
  isStreamStale,
} from "./stream-contract.js";

export const SSE_TRANSPORTS = Object.freeze({
  IDLE: "IDLE",
  CONNECTING: "CONNECTING",
  OPEN: "OPEN",
  RECONNECTING: "RECONNECTING",
  CLOSED: "CLOSED",
  FAILED: "FAILED",
});

const SYMBOL_PATTERN = /^[A-Za-z0-9]{4,6}$/;
const UPSTREAM_HOST_PATTERN = /fugle/i;
const SECRET_OPTION_PATTERN = /api[_-]?key|secret|[^a-z]token|^token$|password|credential|authorization|bearer/i;
const KNOWN_OPTIONS = new Set(["baseUrl", "eventSourceFactory", "now", "maxEvents", "maxDiagnostics", "staleAfterMs", "maxTransportErrors"]);
/* Persistent HTTP-level failures (429/503/404 HTML, no SSE frames) make
   native EventSource retry FOREVER. Fail-closed budget: this many
   consecutive transport errors with zero sign of life → close + FAILED,
   wait for an explicit user start. Any open/state/trade resets it. */
const DEFAULT_MAX_TRANSPORT_ERRORS = 10;

/* Domain errors after which the server already closed the sink AND a
   browser auto-reconnect would only hammer a terminal condition:
   close the EventSource (no reconnect storm), surface FAILED, wait for
   an explicit user start. Everything else stays open for native retry. */
const TERMINAL_ERROR_CODES = new Set([
  "STREAM_AUTH_FAILED",
  "STREAM_SUBSCRIBE_FAILED",
  "STREAM_RATE_LIMITED",
  "STREAM_SCHEMA_INVALID",
  "STREAM_RECONNECT_EXHAUSTED",
  "INVALID_SYMBOL",
  "AUTH_REQUIRED",
  "AUTH_FAILED",
  "RATE_LIMITED",
]);

const RETRYABLE_ERROR_CODES = new Set([
  "STREAM_UPSTREAM_CLOSED",
  "STREAM_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "SSE_SLOW_CLIENT",
  "TIMEOUT",
]);

const LISTENER_KINDS = new Set(["transport", "upstream", "trade", "error", "diagnostic"]);

function cleanBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    throw new Error("sse client 需要非空 proxy baseUrl（公開 URL，不是秘密）");
  }
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  // NOTE: no URL literal here on purpose — check-ui gate 12 (no-network)
  // forbids https?:// in js/ (only market-rules.js may hold source constants).
  let protocol = "";
  try {
    protocol = new URL(trimmed).protocol;
  } catch {
    throw new Error("proxy baseUrl 必須是可用網址");
  }
  if (protocol !== "http:" && protocol !== "https:") throw new Error("proxy baseUrl 必須是可用網址");
  if (UPSTREAM_HOST_PATTERN.test(trimmed)) throw new Error("browser 不得直指 upstream host（必須經 proxy）");
  return trimmed;
}

function cleanSymbol(symbol) {
  const upper = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  if (!SYMBOL_PATTERN.test(upper)) throw new Error(`symbol 格式不正確：${symbol}`);
  return upper;
}

export class SseStreamClient {
  #baseUrl;
  #factory;
  #now;
  #maxEvents;
  #maxDiagnostics;
  #staleAfterMs;
  #listeners = new Map();
  #generation = 0;
  #transport = SSE_TRANSPORTS.IDLE;
  #upstream = null;
  #symbol = null;
  #source = null;
  #trades = [];
  #diagnostics = [];
  #eventCount = 0;
  #droppedLate = 0;
  #lastTradeAt = null;
  #error = null;
  #transportErrors = 0;
  #maxTransportErrors;

  constructor({ baseUrl = "", eventSourceFactory = null, now = null, maxEvents = 50, maxDiagnostics = 50, staleAfterMs = DEFAULT_STREAM_STALE_AFTER_MS, maxTransportErrors = DEFAULT_MAX_TRANSPORT_ERRORS, ...extra } = {}) {
    for (const key of Object.keys(extra)) {
      if (SECRET_OPTION_PATTERN.test(key)) throw new Error(`sse client 拒收秘密形狀參數：${key}`);
      throw new Error(`sse client 未知參數：${key}`);
    }
    this.#baseUrl = cleanBaseUrl(baseUrl);
    this.#factory = eventSourceFactory ?? globalThis.EventSource ?? null;
    if (typeof this.#factory !== "function") {
      throw new Error("目前環境無 EventSource（不偽裝連線，請用支援瀏覽器）");
    }
    this.#now = typeof now === "function" ? now : () => Date.now();
    this.#maxEvents = Number.isInteger(maxEvents) && maxEvents > 0 ? maxEvents : 50;
    this.#maxDiagnostics = Number.isInteger(maxDiagnostics) && maxDiagnostics > 0 ? maxDiagnostics : 50;
    this.#staleAfterMs = Number.isFinite(staleAfterMs) && staleAfterMs > 0 ? staleAfterMs : DEFAULT_STREAM_STALE_AFTER_MS;
    this.#maxTransportErrors = Number.isInteger(maxTransportErrors) && maxTransportErrors > 0 ? maxTransportErrors : DEFAULT_MAX_TRANSPORT_ERRORS;
  }

  on(kind, fn) {
    if (!LISTENER_KINDS.has(kind)) throw new Error(`未知監聽種類：${kind}`);
    if (typeof fn !== "function") throw new Error("listener 必須是函式");
    if (!this.#listeners.has(kind)) this.#listeners.set(kind, new Set());
    this.#listeners.get(kind).add(fn);
    return () => this.#listeners.get(kind)?.delete(fn);
  }

  listenerCount(kind = null) {
    if (kind) return this.#listeners.get(kind)?.size ?? 0;
    let total = 0;
    for (const set of this.#listeners.values()) total += set.size;
    return total;
  }

  #emit(kind, payload) {
    for (const fn of this.#listeners.get(kind) ?? []) {
      try { fn(payload); } catch { /* one bad listener must not break fan-out */ }
    }
  }

  #noteDiagnostic(kind, detail) {
    this.#diagnostics.push({ at: this.#now(), kind, detail: String(detail).slice(0, 200) });
    if (this.#diagnostics.length > this.#maxDiagnostics) {
      this.#diagnostics.splice(0, this.#diagnostics.length - this.#maxDiagnostics);
    }
    this.#emit("diagnostic", this.#diagnostics[this.#diagnostics.length - 1]);
  }

  #setTransport(transport, generation) {
    if (generation !== this.#generation) return;
    this.#transport = transport;
    this.#emit("transport", this.getSnapshot());
  }

  /* Detach the previous source WITHOUT removing its listeners: close()
     stops delivery, and the bumped generation is the load-bearing guard
     that drops any zombie frame the dead source still dispatches (late
     message after close / symbol switch). Listener references are dropped
     here so a closed, unreferenced source is GC-eligible. */
  #retire() {
    this.#generation += 1;
    const source = this.#source;
    this.#source = null;
    if (source) {
      try { source.close(); } catch { /* gone */ }
    }
    return this.#generation;
  }

  start(symbol) {
    const clean = cleanSymbol(symbol);
    this.#retire();
    const generation = this.#generation;
    this.#symbol = clean;
    this.#upstream = null;
    this.#error = null;
    const url = `${this.#baseUrl}/api/market/stream?symbol=${encodeURIComponent(clean)}`;
    const source = this.#factory(url);
    this.#source = source;
    const bound = {
      open: () => this.#onOpen(generation),
      error: (event) => this.#onErrorEvent(event, generation),
      state: (event) => this.#onStateEvent(event, generation),
      trade: (event) => this.#onTradeEvent(event, generation),
    };
    try {
      source.addEventListener("open", bound.open);
      source.addEventListener("error", bound.error);
      source.addEventListener("state", bound.state);
      source.addEventListener("trade", bound.trade);
    } catch (error) {
      this.#noteDiagnostic("attach-failed", error?.message ?? "unknown");
      this.#setTransport(SSE_TRANSPORTS.FAILED, generation);
      return this.getSnapshot();
    }
    this.#setTransport(SSE_TRANSPORTS.CONNECTING, generation);
    return this.getSnapshot();
  }

  /* Explicit user intent: same transport as start, but the old symbol's
     late frames are dropped by generation, never rendered. */
  switchSymbol(symbol) {
    return this.start(symbol);
  }

  stop() {
    this.#retire();
    this.#setTransport(SSE_TRANSPORTS.CLOSED, this.#generation);
    return this.getSnapshot();
  }

  close() {
    return this.stop();
  }

  #isCurrent(generation) {
    if (generation !== this.#generation) {
      this.#droppedLate += 1;
      return false;
    }
    return true;
  }

  #onOpen(generation) {
    if (!this.#isCurrent(generation)) return;
    // Transport only. Upstream is still unknown until a state event.
    this.#transportErrors = 0;
    this.#setTransport(SSE_TRANSPORTS.OPEN, generation);
  }

  #onErrorEvent(event, generation) {
    if (!this.#isCurrent(generation)) return;
    // Dual-use "error": a server domain error arrives WITH a string data
    // frame; a transport failure arrives with NO data. Never conflate.
    if (event && typeof event.data === "string") {
      this.#onDomainError(event.data, generation);
      return;
    }
    this.#transportErrors += 1;
    if (this.#transportErrors > this.#maxTransportErrors) {
      try { this.#source?.close(); } catch { /* gone */ }
      this.#error = { code: "STREAM_RECONNECT_EXHAUSTED", message: "瀏覽器重連多次仍失敗，已停止；請手動重試", terminal: true };
      this.#emit("error", { ...this.#error, symbol: this.#symbol, at: this.#now() });
      this.#setTransport(SSE_TRANSPORTS.FAILED, generation);
      return;
    }
    this.#setTransport(SSE_TRANSPORTS.RECONNECTING, generation);
    this.#noteDiagnostic("transport-error", "EventSource error（browser 自動重連中）");
  }

  #onDomainError(raw, generation) {
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      this.#noteDiagnostic("bad-error-frame", "error event 非 JSON，已丟棄");
      return;
    }
    const code = typeof body?.code === "string" ? body.code : "UNKNOWN";
    const message = typeof body?.message === "string" ? body.message : code;
    // Any server frame is a sign of life: reset the transport-error budget
    // (it only counts silent failures with zero frames).
    this.#transportErrors = 0;
    // Fail-closed: only explicitly retryable codes stay open; unknown
    // codes are terminal (no silent auto-retry on surprises).
    const terminal = TERMINAL_ERROR_CODES.has(code) || !RETRYABLE_ERROR_CODES.has(code);
    this.#error = { code, message, terminal };
    this.#emit("error", { ...this.#error, symbol: this.#symbol, at: this.#now() });
    if (terminal) {
      try { this.#source?.close(); } catch { /* gone */ }
      this.#setTransport(SSE_TRANSPORTS.FAILED, generation);
    } else {
      // Retryable: leave the EventSource open for native auto-reconnect.
      this.#setTransport(SSE_TRANSPORTS.RECONNECTING, generation);
    }
  }

  #onStateEvent(event, generation) {
    if (!this.#isCurrent(generation)) return;
    let body = null;
    try {
      body = typeof event?.data === "string" ? JSON.parse(event.data) : null;
    } catch {
      this.#noteDiagnostic("bad-state-frame", "state event 非 JSON，已丟棄");
      return;
    }
    const state = body?.state;
    if (typeof state !== "string" || !Object.values(STREAM_STATES).includes(state)) {
      this.#noteDiagnostic("bad-state-frame", `未知 upstream state：${String(state).slice(0, 40)}`);
      return;
    }
    this.#transportErrors = 0;
    this.#upstream = state;
    this.#emit("upstream", { upstream: state, symbol: this.#symbol, at: this.#now() });
  }

  #onTradeEvent(event, generation) {
    if (!this.#isCurrent(generation)) return;
    let body = null;
    try {
      body = typeof event?.data === "string" ? JSON.parse(event.data) : null;
    } catch {
      this.#noteDiagnostic("bad-trade-frame", "trade event 非 JSON，已丟棄");
      return;
    }
    const symbol = body?.symbol;
    if (typeof symbol !== "string" || symbol.toUpperCase() !== this.#symbol) {
      // Wrong-symbol contamination (or schema drift): drop, never render.
      this.#droppedLate += 1;
      this.#noteDiagnostic("symbol-mismatch", `trade symbol 不符目前 ${this.#symbol}，已丟棄`);
      return;
    }
    if (!Number.isFinite(body?.providerTimestamp)) {
      this.#noteDiagnostic("bad-trade-frame", "trade 缺 providerTimestamp，已丟棄");
      return;
    }
    this.#eventCount += 1;
    this.#transportErrors = 0;
    this.#lastTradeAt = this.#now();
    this.#trades.push(body);
    if (this.#trades.length > this.#maxEvents) {
      this.#trades.splice(0, this.#trades.length - this.#maxEvents);
    }
    this.#emit("trade", body);
  }

  recentTrades() {
    return [...this.#trades];
  }

  diagnostics() {
    return [...this.#diagnostics];
  }

  getSnapshot() {
    return {
      transport: this.#transport,
      upstream: this.#upstream,
      symbol: this.#symbol,
      generation: this.#generation,
      eventCount: this.#eventCount,
      droppedLate: this.#droppedLate,
      transportErrors: this.#transportErrors,
      lastTradeAt: this.#lastTradeAt,
      marketStale: isStreamStale({ lastEventAt: this.#lastTradeAt, now: this.#now(), staleAfterMs: this.#staleAfterMs }),
      error: this.#error ? { ...this.#error } : null,
    };
  }
}
