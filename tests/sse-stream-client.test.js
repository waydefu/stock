/* Phase 7C PR3: provider-neutral browser SSE stream client tests.
   Deterministic fake EventSource (no network, no timers, injected clock).
   Contract under test (js/sse-stream-client.js):
   - transport (EventSource) ≠ upstream (server state events) ≠ market
     freshness (trade meta) are tracked separately, never conflated.
   - generation guard: symbol switch / stop retires the old stream; any
     late message from it is dropped and counted, never rendered.
   - server named "error" event (has string data) ≠ transport "error"
     (no data): terminal domain codes close the stream (no reconnect
     storm), retryable codes leave native auto-reconnect alone.
   - malformed frames are dropped with a bounded diagnostic, never throw.
   - memory is bounded (trades + diagnostics caps).
   - constructor refuses secret-shaped options and upstream URLs: the
     browser must never know the Fugle host or any key. */
import assert from "node:assert/strict";
import test from "node:test";
import { SseStreamClient, SSE_TRANSPORTS } from "../js/sse-stream-client.js";

const NOW = 1_789_000_000_000;

function makeClock(start = NOW) {
  let t = start;
  const clock = () => t;
  clock.advance = (ms) => { t += ms; };
  return clock;
}

/* Minimal scripted EventSource stand-in. */
function makeFactory() {
  const instances = [];
  class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.readyState = 0; // CONNECTING
      this.closed = false;
      this.listeners = new Map();
      instances.push(this);
    }
    addEventListener(kind, fn) {
      if (!this.listeners.has(kind)) this.listeners.set(kind, new Set());
      this.listeners.get(kind).add(fn);
    }
    removeEventListener(kind, fn) {
      this.listeners.get(kind)?.delete(fn);
    }
    close() {
      this.readyState = 2; // CLOSED
      this.closed = true;
    }
    fire(kind, event = {}) {
      for (const fn of [...(this.listeners.get(kind) ?? [])]) fn(event);
    }
    fireOpen() {
      this.readyState = 1;
      this.fire("open", {});
    }
    /* Server named event: SSE data frame arrives as a MessageEvent with data. */
    emitNamed(kind, payload) {
      this.fire(kind, { data: typeof payload === "string" ? payload : JSON.stringify(payload) });
    }
  }
  const factory = (url) => new FakeEventSource(url);
  factory.instances = instances;
  return factory;
}

function startedClient(overrides = {}) {
  const clock = makeClock();
  const factory = makeFactory();
  const client = new SseStreamClient({ baseUrl: "https://proxy.local", eventSourceFactory: factory, now: clock.now ?? clock, ...overrides });
  return { client, clock, factory };
}

function tradePayload(symbol = "2330", ts = NOW - 1000) {
  return {
    provider: "FUGLE", market: "TW", symbol, channel: "trades", dataKind: "realtime",
    source: "fugle-stream", providerTimestamp: ts, receivedAt: ts + 50,
    freshnessMs: 50, stale: false, freshnessStatus: "FRESH", sequence: 7,
    sequenceStatus: "ok", isTrial: false, normalizationVersion: 1, sessionId: "s1",
    trade: { price: 100, size: 5, time: ts },
  };
}

/* 1. start validates the symbol and opens exactly one stream at the proxy URL. */
test("start rejects bad symbols and opens the proxy stream URL", () => {
  const { client, factory } = startedClient();
  assert.throws(() => client.start("!!!"), /symbol/);
  assert.throws(() => client.start(""), /symbol/);
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.IDLE);
  assert.equal(factory.instances.length, 0);
  client.start("2330");
  assert.equal(factory.instances.length, 1);
  assert.equal(factory.instances[0].url, "https://proxy.local/api/market/stream?symbol=2330");
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.CONNECTING);
  assert.equal(client.getSnapshot().symbol, "2330");
});

/* 2. transport open is reported, but is NOT conflated with upstream LIVE. */
test("EventSource open means transport only, never upstream LIVE", () => {
  const { client, factory } = startedClient();
  const seen = [];
  client.on("transport", (s) => seen.push(s.transport));
  client.on("upstream", () => seen.push("UPSTREAM?!"));
  client.start("2330");
  factory.instances[0].fireOpen();
  assert.deepEqual(seen, [SSE_TRANSPORTS.CONNECTING, SSE_TRANSPORTS.OPEN]);
  assert.equal(client.getSnapshot().upstream, null);
});

/* 3. upstream state events update only the upstream slot. */
test("server state events track upstream, transport stays OPEN", () => {
  const { client, factory } = startedClient();
  const upstream = [];
  client.on("upstream", (s) => upstream.push(s.upstream));
  client.start("2330");
  factory.instances[0].fireOpen();
  factory.instances[0].emitNamed("state", { state: "SUBSCRIBING", key: null, sessionId: null, at: NOW });
  factory.instances[0].emitNamed("state", { state: "LIVE", key: null, sessionId: null, at: NOW });
  assert.deepEqual(upstream, ["SUBSCRIBING", "LIVE"]);
  const snap = client.getSnapshot();
  assert.equal(snap.transport, SSE_TRANSPORTS.OPEN);
  assert.equal(snap.upstream, "LIVE");
});

/* 4. trade events update market data only, bounded history. */
test("trade events are stored bounded and never touch transport/upstream", () => {
  const { client, factory } = startedClient({ maxEvents: 3 });
  const trades = [];
  client.on("trade", (t) => trades.push(t));
  client.start("2330");
  factory.instances[0].fireOpen();
  for (let i = 0; i < 5; i += 1) {
    factory.instances[0].emitNamed("trade", tradePayload("2330", NOW - 1000 + i));
  }
  assert.equal(trades.length, 5);
  assert.equal(client.getSnapshot().eventCount, 5);
  assert.equal(client.recentTrades().length, 3);
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.OPEN);
});

/* 5. MUTATION GUARD: symbol switch retires the old generation; late
   messages from it are dropped, never delivered. (If the generation
   check were removed, this test must fail.) */
test("generation guard drops late messages after symbol switch", () => {
  const { client, factory } = startedClient();
  const trades = [];
  client.on("trade", (t) => trades.push(t));
  client.start("2330");
  factory.instances[0].fireOpen();
  client.switchSymbol("0050");
  assert.equal(factory.instances.length, 2);
  assert.ok(factory.instances[0].closed, "old EventSource must be closed");
  // Late 2330 trade arriving on the retired stream:
  factory.instances[0].emitNamed("trade", tradePayload("2330"));
  // Late 2330 state arriving on the retired stream:
  factory.instances[0].emitNamed("state", { state: "LIVE", key: null, sessionId: null, at: NOW });
  assert.equal(trades.length, 0);
  assert.equal(client.getSnapshot().droppedLate, 2);
  assert.equal(client.getSnapshot().symbol, "0050");
  assert.equal(client.getSnapshot().upstream, null);
  // New-generation trade flows:
  factory.instances[1].fireOpen();
  factory.instances[1].emitNamed("trade", tradePayload("0050"));
  assert.equal(trades.length, 1);
});

/* 6. stop() closes the stream; anything arriving after is dropped. */
test("stop closes the stream and drops late messages", () => {
  const { client, factory } = startedClient();
  const trades = [];
  client.on("trade", (t) => trades.push(t));
  client.start("2330");
  factory.instances[0].fireOpen();
  client.stop();
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.CLOSED);
  assert.ok(factory.instances[0].closed);
  factory.instances[0].emitNamed("trade", tradePayload("2330"));
  factory.instances[0].fireOpen();
  assert.equal(trades.length, 0);
  assert.equal(client.getSnapshot().droppedLate, 2);
});

/* 7. terminal domain errors close the stream (no reconnect storm). */
test("terminal error event closes the stream and surfaces FAILED", () => {
  const { client, factory } = startedClient();
  const errors = [];
  const transports = [];
  client.on("error", (e) => errors.push(e));
  client.on("transport", (s) => transports.push(s.transport));
  client.start("2330");
  factory.instances[0].fireOpen();
  factory.instances[0].emitNamed("error", { code: "STREAM_AUTH_FAILED", message: "upstream 認證失敗", key: null, sessionId: null });
  assert.ok(factory.instances[0].closed, "terminal error must close EventSource");
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.FAILED);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "STREAM_AUTH_FAILED");
  assert.equal(errors[0].terminal, true);
  assert.ok(transports.includes(SSE_TRANSPORTS.FAILED));
});

/* 8. retryable domain errors keep native auto-reconnect (no manual close). */
test("retryable error event keeps the stream for native reconnect", () => {
  const { client, factory } = startedClient();
  const errors = [];
  client.on("error", (e) => errors.push(e));
  client.start("2330");
  factory.instances[0].fireOpen();
  factory.instances[0].emitNamed("error", { code: "STREAM_UPSTREAM_CLOSED", message: "upstream 斷線", key: null, sessionId: null });
  assert.equal(factory.instances[0].closed, false);
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.RECONNECTING);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].terminal, false);
});

/* 9. transport-level error (no data frame) means CLIENT_RECONNECTING,
   distinct from server upstream reconnect. */
test("transport error without data is client reconnect, not upstream state", () => {
  const { client, factory } = startedClient();
  const transports = [];
  const upstream = [];
  client.on("transport", (s) => transports.push(s.transport));
  client.on("upstream", (s) => upstream.push(s));
  client.start("2330");
  factory.instances[0].fireOpen();
  factory.instances[0].fire("error", {});
  assert.deepEqual(transports.slice(-1), [SSE_TRANSPORTS.RECONNECTING]);
  assert.equal(upstream.length, 0);
  assert.equal(factory.instances[0].closed, false);
});

/* 10. malformed frames are dropped with a bounded diagnostic, never throw. */
test("malformed state/trade frames are dropped, client stays OPEN", () => {
  const { client, factory } = startedClient({ maxDiagnostics: 2 });
  client.start("2330");
  factory.instances[0].fireOpen();
  factory.instances[0].emitNamed("state", "not-json{{{");
  factory.instances[0].emitNamed("state", { state: "NOPE", at: NOW });
  factory.instances[0].emitNamed("trade", { provider: "FUGLE" });
  factory.instances[0].emitNamed("trade", tradePayload("2317"));
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.OPEN);
  assert.equal(client.getSnapshot().eventCount, 0);
  assert.equal(client.diagnostics().length, 2, "diagnostics bounded");
});

/* 11. cross-symbol trade contamination is dropped (title 0050, body 2330). */
test("trade for the wrong symbol is dropped, never rendered", () => {
  const { client, factory } = startedClient();
  const trades = [];
  client.on("trade", (t) => trades.push(t));
  client.start("0050");
  factory.instances[0].fireOpen();
  factory.instances[0].emitNamed("trade", tradePayload("2330"));
  assert.equal(trades.length, 0);
  assert.equal(client.getSnapshot().droppedLate, 1);
});

/* 12. constructor refuses secret-shaped options and upstream URLs. */
test("constructor rejects secrets and upstream hosts", () => {
  const factory = makeFactory();
  assert.throws(() => new SseStreamClient({ baseUrl: "https://proxy.local", apiKey: "x", eventSourceFactory: factory }), /秘密|secret/i);
  assert.throws(() => new SseStreamClient({ baseUrl: "https://api.fugle.tw", eventSourceFactory: factory }), /upstream|fugle/i);
  assert.throws(() => new SseStreamClient({ baseUrl: "", eventSourceFactory: factory }), /baseUrl/);
});

/* 13. retired sources are closed but keep listeners: the generation guard
   (not listener removal) is what silences zombie frames. */
test("retired source stays listened but its zombie frames are dropped", () => {
  const { client, factory } = startedClient();
  const trades = [];
  client.on("trade", (t) => trades.push(t));
  client.start("2330");
  const first = factory.instances[0];
  client.stop();
  assert.equal(first.closed, true);
  assert.equal(first.listeners.get("trade")?.size, 1, "listeners stay; guard decides");
  first.emitNamed("trade", tradePayload("2330"));
  assert.equal(trades.length, 0);
  assert.equal(client.getSnapshot().droppedLate, 1);
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.CLOSED);
});

/* 15. RESOURCE LEAK BUDGET: start/stop/symbol-switch loop leaves no
   growth — client listeners constant, trade memory bounded. */
test("start/stop loop leaves no growth: listeners and memory bounded", () => {
  const { client, factory } = startedClient({ maxEvents: 5 });
  client.on("transport", () => {});
  client.on("upstream", () => {});
  client.on("trade", () => {});
  client.on("error", () => {});
  const base = client.listenerCount();
  for (let i = 0; i < 30; i += 1) {
    const symbol = i % 2 ? "2330" : "0050";
    client.start(symbol);
    const src = factory.instances[factory.instances.length - 1];
    src.fireOpen();
    src.emitNamed("trade", tradePayload(symbol, NOW - 1000 + i));
    client.stop();
  }
  assert.equal(client.listenerCount(), base);
  assert.ok(client.recentTrades().length <= 5);
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.CLOSED);
});

/* 16. STORM BUDGET: consecutive transport errors with no sign of life
   close the stream (no infinite native reconnect); any open resets it. */
test("transport error budget fails closed, open resets the count", () => {
  const { client, factory } = startedClient({ maxTransportErrors: 3 });
  const errors = [];
  client.on("error", (e) => errors.push(e));
  client.start("2330");
  const src = factory.instances[0];
  src.fire("error", {});
  src.fire("error", {});
  src.fire("error", {});
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.RECONNECTING);
  src.fireOpen(); // sign of life resets the budget
  assert.equal(client.getSnapshot().transportErrors, 0);
  src.fire("error", {});
  src.fire("error", {});
  src.fire("error", {});
  src.fire("error", {}); // 4th consecutive exceeds budget 3
  assert.equal(src.closed, true);
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.FAILED);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "STREAM_RECONNECT_EXHAUSTED");
  assert.equal(errors[0].terminal, true);
});

/* 14. restart after FAILED is allowed (user action starts a new generation). */
test("start after FAILED opens a fresh generation", () => {
  const { client, factory } = startedClient();
  client.start("2330");
  factory.instances[0].fireOpen();
  factory.instances[0].emitNamed("error", { code: "STREAM_AUTH_FAILED", message: "x", key: null, sessionId: null });
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.FAILED);
  client.start("2330");
  assert.equal(factory.instances.length, 2);
  assert.equal(client.getSnapshot().transport, SSE_TRANSPORTS.CONNECTING);
  assert.equal(client.getSnapshot().error, null);
});
