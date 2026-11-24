/* Deterministic fake streaming transport (Phase 7C, PR1).
   Drives the stream-contract state machine with a scripted upstream so tests
   and future UI work never need a real socket. No network, no timers of its
   own (clock/scheduler injected), no secrets: authenticate() takes only an
   outcome word, never a key. Listener cleanup is explicit via close(). */
"use strict";

import {
  DATA_ERROR_CODE,
  STREAM_CHANNELS,
  STREAM_ERROR_CODE,
  STREAM_STATES,
  StreamError,
  assertStreamTransition,
  checkSequence,
  classifyUpstreamFrame,
  isStreamStale,
  mapUpstreamError,
  normalizeStreamEvent,
  planReconnect,
} from "./stream-contract.js";

const SYMBOL_PATTERN = /^[A-Za-z0-9]{4,6}$/;

export class FakeStreamProvider {
  #state = STREAM_STATES.IDLE;
  #provider;
  #market;
  #source;
  #sessionId;
  #clock;
  #staleAfterMs;
  #authOutcome;
  #subscribeOutcomes;
  #listeners = new Map();
  #serials = new Map();
  #lastEventAt = null;
  #lastHeartbeatAt = null;
  #reconnectAttempt = 0;

  constructor({
    provider = "FAKE",
    market = "TW",
    source = "FAKE_STREAM",
    sessionId = null,
    clock = () => Date.now(),
    staleAfterMs,
    authOutcome = "ok",
    subscribeOutcomes = {},
  } = {}) {
    this.#provider = provider;
    this.#market = market;
    this.#source = source;
    this.#sessionId = sessionId ?? `fake-${Math.floor(clock())}`;
    this.#clock = clock;
    this.#staleAfterMs = staleAfterMs;
    this.#authOutcome = authOutcome;
    this.#subscribeOutcomes = { ...subscribeOutcomes };
  }

  getState() {
    return this.#state;
  }

  listenerCount(kind = null) {
    if (kind) return this.#listeners.get(kind)?.size ?? 0;
    let total = 0;
    for (const set of this.#listeners.values()) total += set.size;
    return total;
  }

  on(kind, fn) {
    if (typeof fn !== "function") throw new StreamError(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, "listener 必須是函式");
    if (!this.#listeners.has(kind)) this.#listeners.set(kind, new Set());
    this.#listeners.get(kind).add(fn);
    return () => this.#listeners.get(kind)?.delete(fn);
  }

  #emit(kind, payload) {
    for (const fn of this.#listeners.get(kind) ?? []) fn(payload);
  }

  #move(to) {
    this.#state = assertStreamTransition(this.#state, to);
    this.#emit("state", { from: undefined, to: this.#state, at: this.#clock() });
    return this.#state;
  }

  connect() {
    this.#move(STREAM_STATES.CONNECTING);
    return this.#state;
  }

  /* outcome comes from construction, never from a caller-supplied secret. */
  authenticate() {
    this.#move(STREAM_STATES.AUTHENTICATING);
    if (this.#authOutcome === "ok") {
      this.#emit("upstream", { event: "authenticated", data: { message: "Authenticated successfully" } });
      return this.#state;
    }
    this.#move(STREAM_STATES.FAILED);
    const error = mapUpstreamError({ event: "error", data: { message: "Invalid authentication credentials" } });
    this.#emit("error", error);
    throw error;
  }

  subscribe({ channel, symbol }) {
    if (!Object.values(STREAM_CHANNELS).includes(channel)) {
      throw new StreamError(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, `未知 stream channel：${channel}`);
    }
    if (typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol)) {
      throw new StreamError(DATA_ERROR_CODE.INVALID_SYMBOL, `symbol 格式不正確：${symbol}`);
    }
    this.#move(STREAM_STATES.SUBSCRIBING);
    const outcome = this.#subscribeOutcomes[`${channel}:${symbol.toUpperCase()}`] ?? this.#subscribeOutcomes[channel] ?? "ok";
    if (outcome !== "ok") {
      this.#move(STREAM_STATES.FAILED);
      const error = new StreamError(STREAM_ERROR_CODE.STREAM_SUBSCRIBE_FAILED, `訂閱失敗：${channel}/${symbol}`, { channel, symbol });
      this.#emit("error", error);
      throw error;
    }
    this.#move(STREAM_STATES.LIVE);
    this.#lastEventAt = this.#clock();
    this.#emit("upstream", { event: "subscribed", data: { id: `fake-${channel}-${symbol}`, channel, symbol: symbol.toUpperCase() } });
    return this.#state;
  }

  /* Heartbeat = liveness only. It never touches lastEventAt, so it can never
     mask a stale market stream (contract B5). */
  heartbeat() {
    if (this.#state !== STREAM_STATES.LIVE && this.#state !== STREAM_STATES.STALE) {
      throw new StreamError(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, `heartbeat 只在 LIVE/STALE 接受（現為 ${this.#state}）`);
    }
    this.#lastHeartbeatAt = this.#clock();
    this.#emit("upstream", { event: "heartbeat", data: { time: this.#lastHeartbeatAt } });
    return { at: this.#lastHeartbeatAt, live: true };
  }

  feed({ channel, symbol, payload, providerTimestamp = null, receivedAt = null, isTrial = false }) {
    if (this.#state !== STREAM_STATES.LIVE && this.#state !== STREAM_STATES.STALE) {
      throw new StreamError(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, `feed 只在 LIVE/STALE 接受（現為 ${this.#state}）`);
    }
    const clean = String(symbol).toUpperCase();
    const envelope = normalizeStreamEvent(payload ?? {}, {
      provider: this.#provider,
      market: this.#market,
      symbol: clean,
      channel,
      providerTimestamp: providerTimestamp ?? this.#clock(),
      receivedAt: receivedAt ?? this.#clock(),
      source: this.#source,
      sessionId: this.#sessionId,
      isTrial,
      now: this.#clock(),
    });
    const key = `${channel}:${clean}`;
    const sequenceStatus = checkSequence(this.#serials.get(key), envelope.meta.sequence);
    if (envelope.meta.sequence !== null) this.#serials.set(key, envelope.meta.sequence);
    this.#lastEventAt = this.#clock();
    if (this.#state === STREAM_STATES.STALE) this.#move(STREAM_STATES.LIVE);
    this.#emit("stream-event", { envelope, sequenceStatus });
    return { envelope, sequenceStatus };
  }

  /* Consumer-side staleness probe: heartbeat-alive but event-silent => STALE. */
  probeStale() {
    if (this.#state !== STREAM_STATES.LIVE && this.#state !== STREAM_STATES.STALE) return this.#state;
    const stale = isStreamStale({ lastEventAt: this.#lastEventAt, now: this.#clock(), ...(this.#staleAfterMs ? { staleAfterMs: this.#staleAfterMs } : {}) });
    if (stale && this.#state === STREAM_STATES.LIVE) this.#move(STREAM_STATES.STALE);
    if (!stale && this.#state === STREAM_STATES.STALE) this.#move(STREAM_STATES.LIVE);
    return this.#state;
  }

  upstreamClose() {
    if (this.#state === STREAM_STATES.CLOSED || this.#state === STREAM_STATES.IDLE) return this.#state;
    const error = new StreamError(STREAM_ERROR_CODE.STREAM_UPSTREAM_CLOSED, "upstream 連線關閉");
    this.#emit("error", error);
    if ([STREAM_STATES.LIVE, STREAM_STATES.STALE, STREAM_STATES.RECONNECTING].includes(this.#state)) {
      this.#move(STREAM_STATES.RECONNECTING);
    } else {
      this.#move(STREAM_STATES.CLOSED);
    }
    return this.#state;
  }

  /* One bounded reconnect step; exhaustion lands on FAILED, never loops. */
  reconnectStep() {
    if (this.#state !== STREAM_STATES.RECONNECTING) {
      throw new StreamError(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, `reconnectStep 只在 RECONNECTING 接受（現為 ${this.#state}）`);
    }
    this.#reconnectAttempt += 1;
    try {
      const plan = planReconnect(this.#reconnectAttempt);
      this.#emit("reconnect", plan);
      return plan;
    } catch (error) {
      this.#move(STREAM_STATES.FAILED);
      this.#emit("error", error);
      throw error;
    }
  }

  get lastHeartbeatAt() {
    return this.#lastHeartbeatAt;
  }

  unsubscribe() {
    if (this.#state !== STREAM_STATES.LIVE && this.#state !== STREAM_STATES.STALE) {
      throw new StreamError(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, `unsubscribe 只在 LIVE/STALE 接受（現為 ${this.#state}）`);
    }
    this.#serials.clear();
    this.#move(STREAM_STATES.CLOSED);
    return this.#state;
  }

  abort() {
    if (this.#state === STREAM_STATES.CLOSED) return this.#state;
    this.#move(STREAM_STATES.CLOSED);
    return this.#state;
  }

  /* Client gone: every listener dropped, serials cleared — no zombie state. */
  close() {
    this.#listeners.clear();
    this.#serials.clear();
    if (this.#state !== STREAM_STATES.CLOSED && this.#state !== STREAM_STATES.IDLE) {
      this.#state = assertStreamTransition(this.#state, STREAM_STATES.CLOSED);
    }
    return { state: this.#state, listeners: 0 };
  }
}

export { classifyUpstreamFrame };
