/* Phase 7C PR2b: upstream manager — deterministic via injected socket
   factory, clock, timers. No real network. Sentinel secret proves no leak. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  FUGLE_STREAM_URL,
  assertStreamChannel,
  assertStreamSymbol,
  createStreamManager,
  normalizeFugleTrade,
  streamKey,
} from "../server/fugle-stream-manager.js";
import { STREAM_ERROR_CODE, STREAM_STATES } from "../js/stream-contract.js";

const SENTINEL = "SUPER_SECRET_TEST_KEY_7C";
const NOW = 1_786_000_000_000;
/* Official trades example (developer.fugle.tw, "Last updated Jan 9, 2026"):
   time 1685338200000000 (microseconds), serial 6652422. */
const TRADE_FRAME = Object.freeze({
  event: "data",
  data: {
    symbol: "2330", type: "EQUITY", exchange: "TWSE", market: "TSE",
    bid: 567, ask: 568, price: 568, size: 4778, volume: 54538,
    isClose: true, time: 1685338200000000, serial: 6652422,
  },
  id: "cid-1",
  channel: "trades",
});

function makeClock(start = NOW) {
  let t = start;
  const clock = () => t;
  clock.advance = (ms) => { t += ms; };
  return clock;
}

function makeTimers() {
  let now = 0;
  let seq = 1;
  const pending = new Map();
  return {
    setTimeout: (fn, ms) => { const id = seq++; pending.set(id, { fn, at: now + ms }); return id; },
    clearTimeout: (id) => { pending.delete(id); },
    tick: (ms) => {
      now += ms;
      const due = [...pending.entries()].filter(([, job]) => job.at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const [id, job] of due) { pending.delete(id); job.fn(); }
    },
    pendingCount: () => pending.size,
  };
}

function makeSocketFactory(sockets) {
  return (url) => {
    const s = {
      url, readyState: 1, sent: [], closed: false,
      send: (msg) => { s.sent.push(JSON.parse(msg)); },
      close: () => { if (!s.closed) { s.closed = true; s.readyState = 3; s.onclose?.(); } },
      open: () => { s.onopen?.(); },
      receive: (obj) => { s.onmessage?.(typeof obj === "string" ? obj : JSON.stringify(obj)); },
    };
    sockets.push(s);
    return s;
  };
}

function makeSink({ failWrite = false } = {}) {
  const events = [];
  const sink = {
    events,
    closed: false,
    sendState: (state) => { events.push({ e: "state", state }); return true; },
    sendTrade: (envelope, status) => { events.push({ e: "trade", price: envelope.data.price, seq: status }); return !failWrite; },
    sendError: (code) => { events.push({ e: "error", code }); return true; },
    close: () => { sink.closed = true; },
  };
  return sink;
}

function setup(overrides = {}) {
  const clock = makeClock();
  const timers = makeTimers();
  const sockets = [];
  const logs = [];
  const mgr = createStreamManager({
    apiKey: SENTINEL,
    webSocketFactory: makeSocketFactory(sockets),
    clock,
    timers,
    id: () => "test-session",
    logger: (entry) => { logs.push(entry); },
    ...overrides,
  });
  return { mgr, clock, timers, sockets, logs };
}

function goLive(setupCtx, sink, symbol = "2330") {
  const { mgr, sockets } = setupCtx;
  mgr.subscribe(symbol, "trades", sink);
  const ws = sockets.at(-1);
  ws.open();
  ws.receive({ event: "authenticated", data: { message: "Authenticated successfully" } });
  ws.receive({ event: "subscribed", data: { id: "cid-1", channel: "trades", symbol } });
  return ws;
}

test("upstream URL is the official endpoint", () => {
  assert.equal(FUGLE_STREAM_URL, "wss://api.fugle.tw/marketdata/v1.0/stock/streaming");
});

test("auth frame is generated server-side and never logged", () => {
  const ctx = setup();
  const sink = makeSink();
  ctx.mgr.subscribe("2330", "trades", sink);
  assert.equal(ctx.sockets.length, 1);
  assert.equal(ctx.sockets[0].url, FUGLE_STREAM_URL);
  ctx.sockets[0].open();
  assert.deepEqual(ctx.sockets[0].sent, [{ event: "auth", data: { apikey: SENTINEL } }]);
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.AUTHENTICATING);
  assert.ok(!JSON.stringify(ctx.logs).includes(SENTINEL));
});

test("socket open alone is not LIVE", () => {
  const ctx = setup();
  ctx.mgr.subscribe("2330", "trades", makeSink());
  ctx.sockets[0].open();
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.AUTHENTICATING);
});

test("authenticated ack moves to SUBSCRIBING with subscribe frame", () => {
  const ctx = setup();
  ctx.mgr.subscribe("2330", "trades", makeSink());
  const ws = ctx.sockets[0];
  ws.open();
  ws.receive({ event: "authenticated", data: {} });
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.SUBSCRIBING);
  assert.deepEqual(ws.sent.at(-1), { event: "subscribe", data: { channel: "trades", symbol: "2330" } });
});

test("subscribed ack reaches LIVE and notifies client", () => {
  const ctx = setup();
  const sink = makeSink();
  const ws = goLive(ctx, sink);
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.LIVE);
  assert.ok(sink.events.some((e) => e.e === "state" && e.state === "LIVE"));
  assert.equal(ws.url, FUGLE_STREAM_URL);
});

test("official trade normalizes with microsecond conversion locked", () => {
  const envelope = normalizeFugleTrade(TRADE_FRAME, { symbol: "2330", channel: "trades", sessionId: "s", receivedAt: NOW, now: NOW });
  assert.equal(envelope.data.price, 568);
  assert.equal(envelope.meta.provider, "FUGLE");
  assert.equal(envelope.meta.providerTimestamp, 1685338200000);
  assert.equal(envelope.meta.sequence, 6652422);
  assert.equal(envelope.meta.isTrial, false);
  assert.equal(envelope.meta.source, "FUGLE_STREAM");
  assert.equal(envelope.meta.sessionId, "s");
  assert.ok(!("event" in envelope) && !("id" in envelope.meta));
});

test("isTrial survives normalization", () => {
  const frame = { event: "data", data: { ...TRADE_FRAME.data, isTrial: true }, id: "x", channel: "trades" };
  const envelope = normalizeFugleTrade(frame, { symbol: "2330", channel: "trades", sessionId: "s", receivedAt: NOW, now: NOW });
  assert.equal(envelope.meta.isTrial, true);
});

test("heartbeat is liveness only, never refreshes market", () => {
  const ctx = setup();
  const sink = makeSink();
  goLive(ctx, sink);
  ctx.clock.advance(61_000);
  assert.equal(ctx.mgr.probeStale(), STREAM_STATES.STALE);
  ctx.sockets[0].receive({ event: "heartbeat", data: { time: 1 } });
  assert.ok(Number.isFinite(ctx.mgr.lastHeartbeatAt));
  assert.equal(ctx.mgr.probeStale(), STREAM_STATES.STALE);
});

test("duplicate serial dropped, out-of-order forwarded with status", () => {
  const ctx = setup();
  const sink = makeSink();
  const ws = goLive(ctx, sink);
  ws.receive(TRADE_FRAME);
  ws.receive(TRADE_FRAME);
  ws.receive({ event: "data", data: { ...TRADE_FRAME.data, serial: 6652420 }, id: "cid-1", channel: "trades" });
  const trades = sink.events.filter((e) => e.e === "trade");
  assert.equal(trades.length, 2);
  assert.deepEqual(trades.map((t) => t.seq), ["ok", "out-of-order"]);
});

test("malformed frame dropped, connection alive", () => {
  const ctx = setup();
  const sink = makeSink();
  const ws = goLive(ctx, sink);
  ws.receive("{{{not json");
  ws.receive({ event: "frobnicate" });
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.LIVE);
  ws.receive(TRADE_FRAME);
  assert.equal(sink.events.filter((e) => e.e === "trade").length, 1);
});

test("trade missing time dropped without crash", () => {
  const ctx = setup();
  const sink = makeSink();
  const ws = goLive(ctx, sink);
  ws.receive({ event: "data", data: { symbol: "2330", price: 1 }, id: "x", channel: "trades" });
  assert.equal(sink.events.filter((e) => e.e === "trade").length, 0);
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.LIVE);
});

test("same key shares one upstream; both clients fanned out", () => {
  const ctx = setup();
  const a = makeSink();
  const b = makeSink();
  const ws = goLive(ctx, a);
  ctx.mgr.subscribe("2330", "trades", b);
  assert.equal(ctx.sockets.length, 1);
  assert.equal(ws.sent.filter((m) => m.event === "subscribe").length, 1);
  ws.receive(TRADE_FRAME);
  assert.equal(a.events.filter((e) => e.e === "trade").length, 1);
  assert.equal(b.events.filter((e) => e.e === "trade").length, 1);
});

test("one client disconnect keeps the other live, no unsubscribe", () => {
  const ctx = setup();
  const a = makeSink();
  const b = makeSink();
  const ws = goLive(ctx, a);
  ctx.mgr.subscribe("2330", "trades", b);
  ctx.mgr.detach(a);
  ws.receive(TRADE_FRAME);
  assert.equal(b.events.filter((e) => e.e === "trade").length, 1);
  assert.ok(!ws.sent.some((m) => m.event === "unsubscribe"));
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.LIVE);
});

test("last client cleanup unsubscribes, closes socket and timers", () => {
  const ctx = setup();
  const sink = makeSink();
  const ws = goLive(ctx, sink);
  ctx.mgr.detach(sink);
  assert.deepEqual(ws.sent.at(-1), { event: "unsubscribe", data: { id: "cid-1" } });
  assert.equal(ws.closed, true);
  assert.equal(ctx.timers.pendingCount(), 0);
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.CLOSED);
});

test("unexpected close enters RECONNECTING and resubscribes on recovery", () => {
  const ctx = setup();
  const sink = makeSink();
  const ws = goLive(ctx, sink);
  ws.close();
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.RECONNECTING);
  assert.ok(sink.events.some((e) => e.e === "state" && e.state === "RECONNECTING"));
  ctx.timers.tick(1000);
  assert.equal(ctx.sockets.length, 2);
  const ws2 = ctx.sockets[1];
  ws2.open();
  assert.deepEqual(ws2.sent[0], { event: "auth", data: { apikey: SENTINEL } });
  ws2.receive({ event: "authenticated", data: {} });
  assert.deepEqual(ws2.sent.at(-1), { event: "subscribe", data: { channel: "trades", symbol: "2330" } });
  ws2.receive({ event: "subscribed", data: { id: "cid-2", channel: "trades", symbol: "2330" } });
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.LIVE);
  ws2.receive(TRADE_FRAME);
  assert.equal(sink.events.filter((e) => e.e === "trade").length, 1);
});

test("reconnect exhaustion lands FAILED with stable code", () => {
  const ctx = setup();
  const sink = makeSink();
  goLive(ctx, sink);
  ctx.sockets[0].close();
  for (let i = 0; i < 5; i++) {
    ctx.timers.tick(60_000);
    const ws = ctx.sockets.at(-1);
    if (!ws.closed) ws.close();
  }
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.FAILED);
  assert.ok(sink.events.some((e) => e.e === "error" && e.code === STREAM_ERROR_CODE.STREAM_RECONNECT_EXHAUSTED));
  assert.equal(ctx.timers.pendingCount(), 0);
});

test("auth failure fails closed with no retry storm", () => {
  const ctx = setup();
  const sink = makeSink();
  ctx.mgr.subscribe("2330", "trades", sink);
  ctx.sockets[0].open();
  ctx.sockets[0].receive({ event: "error", data: { message: "Invalid authentication credentials" } });
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.FAILED);
  assert.ok(sink.events.some((e) => e.e === "error" && e.code === STREAM_ERROR_CODE.STREAM_AUTH_FAILED));
  assert.equal(ctx.timers.pendingCount(), 0);
});

test("new key while SUBSCRIBING still gets its subscribe frame", () => {
  const ctx = setup();
  const a = makeSink();
  ctx.mgr.subscribe("2330", "trades", a);
  const ws = ctx.sockets[0];
  ws.open();
  ws.receive({ event: "authenticated", data: {} });
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.SUBSCRIBING);
  ctx.mgr.subscribe("2317", "trades", makeSink());
  const frames = ws.sent.filter((m) => m.event === "subscribe");
  assert.deepEqual(frames.map((m) => m.data.symbol).sort(), ["2317", "2330"]);
});

test("late subscribed ack on LIVE does not throw", () => {
  const ctx = setup();
  const ws = goLive(ctx, makeSink());
  ws.receive({ event: "subscribed", data: { id: "cid-1", channel: "trades", symbol: "2330" } });
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.LIVE);
});

test("detaching an unknown client never kills a healthy upstream", () => {
  const ctx = setup();
  const sink = makeSink();
  const ws = goLive(ctx, sink);
  ctx.mgr.detach(makeSink());
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.LIVE);
  assert.equal(ws.closed, false);
  ws.receive(TRADE_FRAME);
  assert.equal(sink.events.filter((e) => e.e === "trade").length, 1);
});

test("caps shed with STREAM_RATE_LIMITED", () => {
  const ctx = setup({ maxSseClients: 1 });
  ctx.mgr.subscribe("2330", "trades", makeSink());
  assert.throws(() => ctx.mgr.subscribe("2317", "trades", makeSink()), (e) => e.code === STREAM_ERROR_CODE.STREAM_RATE_LIMITED);
  const ctx2 = setup({ maxSubscriptionKeys: 1 });
  ctx2.mgr.subscribe("2330", "trades", makeSink());
  assert.throws(() => ctx2.mgr.subscribe("2317", "trades", makeSink()), (e) => e.code === STREAM_ERROR_CODE.STREAM_RATE_LIMITED);
});

test("abort mid-handshake cleans up socket and timers", () => {
  const ctx = setup();
  const sink = makeSink();
  ctx.mgr.subscribe("2330", "trades", sink);
  ctx.mgr.detach(sink);
  assert.equal(ctx.sockets[0].closed, true);
  assert.equal(ctx.timers.pendingCount(), 0);
  assert.equal(ctx.mgr.debug().state, STREAM_STATES.CLOSED);
});

test("shutdown closes everything and reports counts", () => {
  const ctx = setup();
  const a = makeSink();
  const b = makeSink();
  goLive(ctx, a);
  ctx.mgr.subscribe("2317", "trades", b);
  const done = ctx.mgr.shutdown();
  assert.deepEqual([done.clients, done.keys, done.state], [2, 2, STREAM_STATES.CLOSED]);
  assert.equal(a.closed && b.closed, true);
  assert.equal(ctx.timers.pendingCount(), 0);
});

test("sentinel secret appears in no log and no client event", () => {
  const ctx = setup();
  const sink = makeSink();
  const ws = goLive(ctx, sink);
  ws.receive(TRADE_FRAME);
  ws.receive({ event: "error", data: { message: "boom" } });
  ws.close();
  ctx.timers.tick(1000);
  const text = JSON.stringify(ctx.logs) + JSON.stringify(sink.events);
  assert.ok(!text.includes(SENTINEL));
});

test("stale wording comes from events, not outage claims", () => {
  const ctx = setup();
  goLive(ctx, makeSink());
  ctx.clock.advance(61_000);
  assert.equal(ctx.mgr.probeStale(), STREAM_STATES.STALE);
});

test("symbol and channel validation", () => {
  assert.equal(assertStreamSymbol("2330"), "2330");
  assert.equal(streamKey("2330", "trades"), "FUGLE:TW:2330:trades");
  assert.equal(assertStreamChannel("trades"), "trades");
  assert.throws(() => assertStreamSymbol("../../"), (e) => e.code === STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID);
  assert.throws(() => assertStreamSymbol("x".repeat(40)), (e) => e.code === STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID);
  assert.throws(() => assertStreamChannel("books"), (e) => e.code === STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID);
});
