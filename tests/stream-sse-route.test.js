/* Phase 7C PR2b: SSE serialization + /api/market/stream route.
   Route tests use the real manager with a fake upstream factory and fake
   response objects — no network, no timers left behind (asserted). */
import assert from "node:assert/strict";
import test from "node:test";
import { createProxy } from "../server/market-proxy.js";
import { createStreamManager } from "../server/fugle-stream-manager.js";
import {
  DEFAULT_SSE_KEEPALIVE_MS,
  SSE_HEADERS,
  createSseSink,
  errorPayload,
  formatKeepalive,
  formatSseEvent,
  statePayload,
  tradePayload,
} from "../server/stream-sse.js";
import { STREAM_ERROR_CODE } from "../js/stream-contract.js";

const NOW = 1_786_000_000_000;

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
  return () => {
    const s = {
      readyState: 1, sent: [], closed: false,
      send: (msg) => { s.sent.push(JSON.parse(msg)); },
      close: () => { if (!s.closed) { s.closed = true; s.readyState = 3; s.onclose?.(); } },
      open: () => { s.onopen?.(); },
      receive: (obj) => { s.onmessage?.(typeof obj === "string" ? obj : JSON.stringify(obj)); },
    };
    sockets.push(s);
    return s;
  };
}

/* Fake ServerResponse: captures headers/body, models 'close', write() result. */
function fakeSseRes({ writeOk = true } = {}) {
  const handlers = {};
  const res = {
    statusCode: 0, headers: {}, body: "", ended: false,
    writeHead: (code, h = {}) => { res.statusCode = code; for (const [k, v] of Object.entries(h)) res.headers[k.toLowerCase()] = v; },
    write: (chunk) => { res.body += chunk; return writeOk; },
    end: (chunk) => { res.ended = true; if (chunk) res.body += chunk; },
    on: (evt, fn) => { (handlers[evt] ??= []).push(fn); },
    fireClose: () => { for (const fn of handlers.close ?? []) fn(); },
  };
  return res;
}

function setupManager(overrides = {}) {
  const clock = makeClock();
  const timers = makeTimers();
  const sockets = [];
  const logs = [];
  const mgr = createStreamManager({
    apiKey: "SUPER_SECRET_TEST_KEY_7C",
    webSocketFactory: makeSocketFactory(sockets),
    clock, timers, id: () => "test-session",
    logger: (entry) => { logs.push(entry); },
    ...overrides,
  });
  return { mgr, clock, timers, sockets, logs };
}

function setupProxy(mgr) {
  const logs = [];
  const proxy = createProxy({
    apiKey: "dummy",
    fetchImpl: async () => { throw new Error("must not fetch"); },
    clock: () => NOW,
    logger: (entry) => { logs.push(entry); },
    streamManager: mgr,
    rateLimit: false,
  });
  return { proxy, logs };
}

async function getStream(proxy, path, headers = {}) {
  const res = fakeSseRes();
  await proxy.handler({ method: "GET", url: path, headers }, res);
  return res;
}

test("SSE headers are correct and never wildcard CORS", () => {
  assert.equal(SSE_HEADERS["content-type"], "text/event-stream");
  assert.equal(SSE_HEADERS["cache-control"], "no-cache");
  assert.equal(SSE_HEADERS["connection"], "keep-alive");
  assert.ok(!("access-control-allow-origin" in SSE_HEADERS));
});

test("SSE event and keepalive wire format", () => {
  assert.equal(formatSseEvent("state", { a: 1 }), 'event: state\ndata: {"a":1}\n\n');
  assert.equal(formatKeepalive(), ": keepalive\n\n");
  assert.deepEqual(Object.keys(statePayload({ state: "LIVE" })).sort(), ["at", "key", "sessionId", "state"]);
  const err = errorPayload({ code: "X", message: "m" });
  assert.ok(!JSON.stringify(err).includes("apikey"));
});

test("trade payload carries provenance, never raw frames", () => {
  const envelope = {
    data: { price: 568 },
    meta: {
      provider: "FUGLE", market: "TW", symbol: "2330", channel: "trades",
      dataKind: "realtime", source: "FUGLE_STREAM", providerTimestamp: 1,
      receivedAt: 2, freshnessMs: 3, stale: false, freshnessStatus: "FRESH",
      sequence: 9, isTrial: false, normalizationVersion: 1, sessionId: "s",
    },
  };
  const payload = tradePayload(envelope, "ok");
  assert.equal(payload.provider, "FUGLE");
  assert.equal(payload.sequenceStatus, "ok");
  assert.ok(!("event" in payload) && !JSON.stringify(payload).includes("apikey"));
});

test("sink close is idempotent and fires onGone once", () => {
  let gone = 0;
  const res = fakeSseRes();
  const sink = createSseSink(res, { onGone: () => { gone += 1; } });
  assert.equal(sink.closed, false);
  sink.close();
  sink.close();
  assert.equal(gone, 1);
  assert.equal(res.ended, true);
});

test("stream route attaches SSE with correct headers and state event", async () => {
  const { mgr, sockets } = setupManager();
  const { proxy } = setupProxy(mgr);
  const res = await getStream(proxy, "/api/market/stream?symbol=2330", { origin: "https://waydefu.github.io" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "text/event-stream");
  assert.equal(res.headers["access-control-allow-origin"], "https://waydefu.github.io");
  assert.ok(res.body.includes("event: state"));
  assert.equal(sockets.length, 1);
  res.fireClose();
  assert.equal(mgr.debug().totalClients, 0);
  assert.equal(mgr.debug().state, "CLOSED");
});

test("stream route omits CORS for untrusted origins", async () => {
  const { mgr } = setupManager();
  const { proxy } = setupProxy(mgr);
  const res = await getStream(proxy, "/api/market/stream?symbol=2330", { origin: "https://evil.example" });
  assert.equal(res.statusCode, 200);
  assert.ok(!("access-control-allow-origin" in res.headers));
  res.fireClose();
});

test("stream route rejects bad symbols without touching upstream", async () => {
  const { mgr, sockets } = setupManager();
  const { proxy } = setupProxy(mgr);
  const res = fakeSseRes();
  await proxy.handler({ method: "GET", url: "/api/market/stream?symbol=../../", headers: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(sockets.length, 0);
});

test("stream route without bridge fails closed", async () => {
  const proxy = createProxy({ apiKey: "dummy", fetchImpl: async () => { throw new Error("x"); }, logger: () => {}, rateLimit: false });
  const res = fakeSseRes();
  await proxy.handler({ method: "GET", url: "/api/market/stream?symbol=2330", headers: {} }, res);
  assert.equal(res.statusCode, 503);
});

test("stream route delivers a real normalized trade end to end", async () => {
  const { mgr, sockets } = setupManager();
  const { proxy } = setupProxy(mgr);
  const res = await getStream(proxy, "/api/market/stream?symbol=2330");
  const ws = sockets[0];
  ws.open();
  ws.receive({ event: "authenticated", data: {} });
  ws.receive({ event: "subscribed", data: { id: "cid-9", channel: "trades", symbol: "2330" } });
  ws.receive({
    event: "data",
    data: { symbol: "2330", price: 568, size: 10, volume: 100, time: 1685338200000000, serial: 1, isTrial: false },
    id: "cid-9", channel: "trades",
  });
  assert.ok(res.body.includes("event: trade"));
  assert.ok(res.body.includes('"price":568'));
  assert.ok(res.body.includes('"provider":"FUGLE"'));
  assert.ok(!res.body.includes("SUPER_SECRET_TEST_KEY_7C"));
  res.fireClose();
});

test("stream route sheds the second client over cap with an error event", async () => {
  const { mgr } = setupManager({ maxSseClients: 1 });
  const { proxy } = setupProxy(mgr);
  const first = await getStream(proxy, "/api/market/stream?symbol=2330");
  const second = await getStream(proxy, "/api/market/stream?symbol=2330");
  assert.equal(second.statusCode, 200);
  assert.ok(second.body.includes("STREAM_RATE_LIMITED"));
  first.fireClose();
  second.fireClose();
});

test("slow route client is dropped without killing fan-out", async () => {
  const { mgr, sockets } = setupManager();
  const { proxy } = setupProxy(mgr);
  const fast = await getStream(proxy, "/api/market/stream?symbol=2330");
  const slowRes = fakeSseRes({ writeOk: false });
  await proxy.handler({ method: "GET", url: "/api/market/stream?symbol=2330", headers: {} }, slowRes);
  assert.equal(mgr.debug().totalClients, 2, "慢客戶端在首次 trade 失敗前仍掛著（摘除發生於 backpressure 時）");
  const ws = sockets[0];
  ws.open();
  ws.receive({ event: "authenticated", data: {} });
  ws.receive({ event: "subscribed", data: { id: "c", channel: "trades", symbol: "2330" } });
  ws.receive({
    event: "data",
    data: { symbol: "2330", price: 1, time: 1685338200000000, serial: 5 },
    id: "c", channel: "trades",
  });
  assert.equal(mgr.debug().totalClients, 1, "backpressure 後慢客戶端被摘除");
  assert.ok(fast.body.includes("event: trade"));
  fast.fireClose();
  slowRes.fireClose();
});

test("DEFAULT_SSE_KEEPALIVE_MS is sane", () => {
  assert.ok(DEFAULT_SSE_KEEPALIVE_MS >= 5000 && DEFAULT_SSE_KEEPALIVE_MS <= 60000);
});

test("route leaves no timers or clients after all closes", async () => {
  const ctx = setupManager();
  const { proxy } = setupProxy(ctx.mgr);
  const res = await getStream(proxy, "/api/market/stream?symbol=2317");
  res.fireClose();
  assert.equal(ctx.mgr.debug().totalClients, 0);
  assert.equal(ctx.timers.pendingCount(), 0);
});
