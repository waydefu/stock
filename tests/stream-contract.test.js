/* Phase 7C contract tests: state machine, envelope, freshness split,
   bounded reconnect, fake transport lifecycle, secret redaction.
   Official-rule golden: Fugle trades data shape per
   developer.fugle.tw/docs/data/websocket-api/market-data-channels/trades
   (symbol/time/serial/price/size/volume/isTrial fields); expected values
   below come from that page, never from the implementation. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_STREAM_RECONNECT,
  DEFAULT_STREAM_STALE_AFTER_MS,
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
  redactForLog,
} from "../js/stream-contract.js";
import { FakeStreamProvider } from "../js/fake-stream-provider.js";

const NOW = 1_786_000_000_000;

function makeClock(start = NOW) {
  let t = start;
  const clock = () => t;
  clock.advance = (ms) => { t += ms; };
  return clock;
}

function liveProvider(overrides = {}) {
  const clock = makeClock();
  const p = new FakeStreamProvider({ clock, ...overrides });
  p.connect();
  p.authenticate();
  p.subscribe({ channel: "trades", symbol: "2330" });
  return { p, clock };
}

/* 1. connect: IDLE -> CONNECTING, anything else from IDLE is illegal. */
test("connect moves IDLE to CONNECTING; illegal jumps throw", () => {
  const p = new FakeStreamProvider({ clock: makeClock() });
  assert.equal(p.getState(), STREAM_STATES.IDLE);
  assert.equal(p.connect(), STREAM_STATES.CONNECTING);
  assert.throws(() => assertStreamTransition(STREAM_STATES.IDLE, STREAM_STATES.LIVE), StreamError);
});

/* 2. auth success emits the official authenticated shape. */
test("auth success keeps the official authenticated frame", () => {
  const p = new FakeStreamProvider({ clock: makeClock() });
  const frames = [];
  p.on("upstream", (f) => frames.push(f));
  p.connect();
  p.authenticate();
  assert.equal(p.getState(), STREAM_STATES.AUTHENTICATING);
  assert.deepEqual(frames, [{ event: "authenticated", data: { message: "Authenticated successfully" } }]);
});

/* 3. auth failure -> FAILED with STREAM_AUTH_FAILED (not a string guess). */
test("auth failure lands FAILED with a stable code", () => {
  const p = new FakeStreamProvider({ clock: makeClock(), authOutcome: "bad" });
  p.connect();
  assert.throws(() => p.authenticate(), (e) => e.code === STREAM_ERROR_CODE.STREAM_AUTH_FAILED);
  assert.equal(p.getState(), STREAM_STATES.FAILED);
});

/* 4. subscribe success -> SUBSCRIBING -> LIVE with server id. */
test("subscribe success reaches LIVE with a subscription id", () => {
  const p = new FakeStreamProvider({ clock: makeClock() });
  const frames = [];
  p.on("upstream", (f) => frames.push(f));
  p.connect();
  p.authenticate();
  p.subscribe({ channel: "trades", symbol: "2330" });
  assert.equal(p.getState(), STREAM_STATES.LIVE);
  assert.equal(frames.at(-1).event, "subscribed");
  assert.equal(frames.at(-1).data.symbol, "2330");
});

/* 5. heartbeat ticks liveness but never marks data fresh. */
test("heartbeat is liveness only and rejected outside LIVE/STALE", () => {
  const { p, clock } = liveProvider();
  const beat = p.heartbeat();
  assert.equal(beat.live, true);
  assert.equal(beat.at, NOW);
  clock.advance(DEFAULT_STREAM_STALE_AFTER_MS + 1);
  assert.equal(p.probeStale(), STREAM_STATES.STALE);
  p.heartbeat();
  assert.equal(p.probeStale(), STREAM_STATES.STALE, "心跳不得把 STALE 洗回 LIVE");
  const idle = new FakeStreamProvider({ clock: makeClock() });
  assert.throws(() => idle.heartbeat(), StreamError);
});

/* 6. official golden: trades data normalizes with FUGLE provenance. */
test("official trades payload normalizes (golden from Fugle docs)", () => {
  const clock = makeClock();
  const envelope = normalizeStreamEvent(
    { symbol: "2330", type: "EQUITY", exchange: "TWSE", market: "TSE", bid: 567, ask: 568, price: 568, size: 4778, volume: 54538, serial: 42, isTrial: false },
    { provider: "FUGLE", market: "TW", symbol: "2330", channel: STREAM_CHANNELS.TRADES, providerTimestamp: NOW - 1000, receivedAt: NOW, source: "FUGLE_STREAM", sessionId: "s1", now: NOW },
  );
  assert.equal(envelope.data.price, 568);
  assert.equal(envelope.data.size, 4778);
  assert.equal(envelope.meta.provider, "FUGLE");
  assert.equal(envelope.meta.channel, "trades");
  assert.equal(envelope.meta.sequence, 42);
  assert.equal(envelope.meta.isTrial, false);
  assert.equal(envelope.meta.freshnessStatus, "FRESH");
  assert.equal(envelope.meta.source, "FUGLE_STREAM");
});

/* 7. duplicate serial detected, still delivered with status. */
test("duplicate serial is flagged, not dropped silently", () => {
  const { p } = liveProvider();
  const first = p.feed({ channel: "trades", symbol: "2330", payload: { price: 568, serial: 7 }, providerTimestamp: NOW, receivedAt: NOW });
  const second = p.feed({ channel: "trades", symbol: "2330", payload: { price: 568, serial: 7 }, providerTimestamp: NOW, receivedAt: NOW });
  assert.equal(first.sequenceStatus.status, "ok");
  assert.equal(second.sequenceStatus.status, "duplicate");
});

/* 8. out-of-order serial detected. */
test("out-of-order serial is flagged", () => {
  const { p } = liveProvider();
  p.feed({ channel: "trades", symbol: "2330", payload: { price: 568, serial: 9 }, providerTimestamp: NOW, receivedAt: NOW });
  const late = p.feed({ channel: "trades", symbol: "2330", payload: { price: 567, serial: 8 }, providerTimestamp: NOW, receivedAt: NOW });
  assert.equal(late.sequenceStatus.status, "out-of-order");
});

/* 9. malformed frame classifies, never throws. */
test("malformed and unknown frames classify without throwing", () => {
  assert.equal(classifyUpstreamFrame(null), "malformed");
  assert.equal(classifyUpstreamFrame("nope"), "malformed");
  assert.equal(classifyUpstreamFrame({ event: "frobnicator", data: {} }), "unknown");
  assert.equal(classifyUpstreamFrame({ event: "heartbeat", data: { time: 1 } }), "heartbeat");
  assert.equal(classifyUpstreamFrame({ event: "pong", data: {} }), "pong");
});

/* 10. schema drift: unknown extra fields pass through, missing required fail. */
test("schema drift tolerates extras but rejects missing timestamp", () => {
  const clock = makeClock();
  const ok = normalizeStreamEvent(
    { price: 1, futureField: { nested: [1, 2] } },
    { provider: "FUGLE", symbol: "2330", channel: "trades", providerTimestamp: NOW, receivedAt: NOW, now: NOW },
  );
  assert.deepEqual(ok.data.futureField, { nested: [1, 2] });
  assert.throws(
    () => normalizeStreamEvent({ price: 1 }, { provider: "FUGLE", symbol: "2330", channel: "trades", receivedAt: NOW, now: NOW }),
    (e) => e.code === STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID,
  );
  assert.throws(
    () => normalizeStreamEvent({ price: 1 }, { provider: "FUGLE", symbol: "2330", channel: "nope", providerTimestamp: NOW, receivedAt: NOW, now: NOW }),
    (e) => e.code === STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID,
  );
});

/* 11. disconnect path: upstream close from LIVE -> RECONNECTING. */
test("upstream close from LIVE enters RECONNECTING", () => {
  const { p } = liveProvider();
  const errors = [];
  p.on("error", (e) => errors.push(e));
  assert.equal(p.upstreamClose(), STREAM_STATES.RECONNECTING);
  assert.equal(errors.at(-1).code, STREAM_ERROR_CODE.STREAM_UPSTREAM_CLOSED);
});

/* 12. reconnect steps are bounded with growing delays. */
test("reconnect plan grows delay and stays bounded", () => {
  const first = planReconnect(1);
  const second = planReconnect(2);
  assert.equal(first.action, "retry");
  assert.ok(second.delayMs >= first.delayMs);
  assert.ok(first.delayMs >= 1000 && second.delayMs <= 30_000);
});

/* 13. repeated reconnect failure exhausts into FAILED. */
test("reconnect exhaustion lands FAILED, never loops", () => {
  const { p } = liveProvider();
  p.upstreamClose();
  let last;
  for (let i = 0; i < DEFAULT_STREAM_RECONNECT.maxAttempts; i++) last = p.reconnectStep();
  assert.equal(last.action, "retry");
  assert.throws(() => p.reconnectStep(), (e) => e.code === STREAM_ERROR_CODE.STREAM_RECONNECT_EXHAUSTED);
  assert.equal(p.getState(), STREAM_STATES.FAILED);
});

/* 14. stale transition both ways on event silence / arrival. */
test("event silence flips STALE; arrival flips back to LIVE", () => {
  const { p, clock } = liveProvider();
  clock.advance(DEFAULT_STREAM_STALE_AFTER_MS + 1);
  assert.equal(p.probeStale(), STREAM_STATES.STALE);
  p.feed({ channel: "trades", symbol: "2330", payload: { price: 1, serial: 1 }, providerTimestamp: clock(), receivedAt: clock() });
  assert.equal(p.getState(), STREAM_STATES.LIVE);
  assert.equal(isStreamStale({ lastEventAt: null, now: clock() }), true);
});

/* 15. unsubscribe clears serials and closes. */
test("unsubscribe closes and resets ordering state", () => {
  const { p } = liveProvider();
  p.feed({ channel: "trades", symbol: "2330", payload: { price: 1, serial: 3 }, providerTimestamp: NOW, receivedAt: NOW });
  assert.equal(p.unsubscribe(), STREAM_STATES.CLOSED);
  assert.throws(() => p.feed({ channel: "trades", symbol: "2330", payload: { price: 1 }, providerTimestamp: NOW, receivedAt: NOW }), StreamError);
});

/* 16. client disconnect cleanup drops every listener. */
test("close() drops all listeners and freezes the socket", () => {
  const { p } = liveProvider();
  p.on("state", () => {});
  p.on("stream-event", () => {});
  p.on("error", () => {});
  assert.ok(p.listenerCount() >= 3);
  const done = p.close();
  assert.equal(done.listeners, 0);
  assert.equal(p.listenerCount(), 0);
  assert.equal(done.state, STREAM_STATES.CLOSED);
});

/* 17. upstream close from IDLE is a no-op, never an exception. */
test("upstream close before connect is a safe no-op", () => {
  const p = new FakeStreamProvider({ clock: makeClock() });
  assert.equal(p.upstreamClose(), STREAM_STATES.IDLE);
});

/* 18. abort/cancel mid-handshake lands CLOSED. */
test("abort during CONNECTING lands CLOSED", () => {
  const p = new FakeStreamProvider({ clock: makeClock() });
  p.connect();
  assert.equal(p.abort(), STREAM_STATES.CLOSED);
  assert.equal(p.abort(), STREAM_STATES.CLOSED, "重複 abort 冪等");
});

/* 19. unknown symbol rejected with INVALID_SYMBOL, channel checked first. */
test("bad symbol and bad channel reject with stable codes", () => {
  const p = new FakeStreamProvider({ clock: makeClock() });
  p.connect();
  p.authenticate();
  assert.throws(() => p.subscribe({ channel: "trades", symbol: "!!" }), (e) => e.code === "INVALID_SYMBOL");
  assert.throws(() => p.subscribe({ channel: "nope", symbol: "2330" }), (e) => e.code === STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID);
  const failed = new FakeStreamProvider({ clock: makeClock(), subscribeOutcomes: { trades: "reject" } });
  failed.connect();
  failed.authenticate();
  assert.throws(() => failed.subscribe({ channel: "trades", symbol: "2330" }), (e) => e.code === STREAM_ERROR_CODE.STREAM_SUBSCRIBE_FAILED);
  assert.equal(failed.getState(), STREAM_STATES.FAILED);
});

/* 20. secret redaction: apikey-shaped keys scrubbed at any depth. */
test("redactForLog scrubs secret-shaped keys including nested auth frames", () => {
  const frame = { event: "auth", data: { apikey: "LIVE-KEY-MUST-NEVER-PRINT", nested: { api_key: "x", ok: 1 } }, list: [{ token: "y" }] };
  const clean = redactForLog(frame);
  const text = JSON.stringify(clean);
  assert.ok(!text.includes("LIVE-KEY-MUST-NEVER-PRINT"));
  assert.equal(clean.data.apikey, "[REDACTED]");
  assert.equal(clean.data.nested.api_key, "[REDACTED]");
  assert.equal(clean.data.nested.ok, 1);
  assert.equal(clean.list[0].token, "[REDACTED]");
  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  assert.equal(redactForLog(cyclic).self, "[Circular]");
});

/* Provider error mapping keeps auth vs subscribe distinct. */
test("upstream error frames map to distinct stable codes", () => {
  assert.equal(mapUpstreamError({ event: "error", data: { message: "Invalid authentication credentials" } }).code, STREAM_ERROR_CODE.STREAM_AUTH_FAILED);
  assert.equal(mapUpstreamError({ event: "error", data: { message: "symbol not found" } }).code, STREAM_ERROR_CODE.STREAM_SUBSCRIBE_FAILED);
});

/* Trial-session flag survives normalization. */
test("isTrial flag is preserved on the envelope", () => {
  const clock = makeClock();
  const envelope = normalizeStreamEvent(
    { price: 500, serial: 1 },
    { provider: "FUGLE", symbol: "2330", channel: "trades", providerTimestamp: NOW, receivedAt: NOW, isTrial: true, now: NOW },
  );
  assert.equal(envelope.meta.isTrial, true);
});
