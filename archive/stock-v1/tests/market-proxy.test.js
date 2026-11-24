import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createProxy } from "../server/market-proxy.js";

const QUOTE_UPSTREAM = JSON.parse(readFileSync(new URL("./fixtures/fugle/quote-success.json", import.meta.url)));
const BARS_UPSTREAM = {
  symbol: "0050", type: "EQUITY", exchange: "TWSE", market: "TSE", timeframe: "D",
  data: [
    { date: "2023-02-06", open: 119.1, high: 120.2, low: 118.9, close: 119.0, volume: 8123456, change: -0.1 },
    { date: "2023-02-07", open: 119.1, high: 120.5, low: 119.0, close: 119.0, volume: 7654321, change: 0.0 },
    { date: "2023-02-08", open: 120.1, high: 120.95, low: 120.0, close: 120.85, volume: 9239321, change: 1.85 },
    { date: "2023-02-09", open: 120.5, high: 121.0, low: 120.3, close: 120.9, volume: 5032245, change: 0.05 },
  ],
  sort: "asc",
};

function stubFetch(handler) {
  return async (url, init) => handler(url, init);
}

function okJson(payload, { status = 200, headers = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, async json() { return payload; } };
}

function fakeReq(method, path, headers = {}, remoteAddress = null) {
  return { method, url: path, headers, socket: remoteAddress ? { remoteAddress } : null };
}

function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: "" };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.writeHead = (code, h = {}) => { res.statusCode = code; for (const [k, v] of Object.entries(h)) res.headers[k.toLowerCase()] = v; };
  res.end = (chunk) => { res.body += chunk ?? ""; };
  return res;
}

async function call(proxy, method, path, headers = {}, remoteAddress = null) {
  const req = fakeReq(method, path, headers, remoteAddress);
  const res = fakeRes();
  await proxy.handler(req, res);
  return { status: res.statusCode, headers: res.headers, json: JSON.parse(res.body || "{}") };
}

function testProxy(steps, opts = {}) {
  const logs = [];
  const proxy = createProxy({
    apiKey: "dummy-key-for-tests-only",
    fetchImpl: stubFetch(steps),
    clock: () => 1685338201000,
    logger: (entry) => { logs.push(entry); },
    sleep: async () => {},
    ...opts,
  });
  return { proxy, logs };
}

test("missing server key fails closed without fallback", async () => {
  const proxy = createProxy({ apiKey: "", fetchImpl: stubFetch(async () => okJson({})), logger: () => {} });
  const r = await call(proxy, "GET", "/api/market/quote?symbol=2330");
  assert.equal(r.status, 503);
  assert.equal(r.json.error.code, "AUTH_REQUIRED");
  assert.ok(typeof r.json.error.requestId === "string");
});

test("quote success returns envelope with requestId", async () => {
  const seen = [];
  const { proxy, logs } = testProxy(async (url, init) => {
    seen.push([url, init]);
    assert.ok(String(init.headers["X-API-KEY"]).length > 0);
    assert.ok(!String(url).includes("symbol=2330&symbol"));
    return okJson(QUOTE_UPSTREAM);
  });
  const r = await call(proxy, "GET", "/api/market/quote?symbol=2330");
  assert.equal(r.status, 200);
  assert.equal(r.json.data.price, 568);
  assert.equal(r.json.meta.provider, "FUGLE");
  assert.equal(r.json.meta.market, "TW");
  assert.equal(r.json.meta.dataKind, "realtime");
  assert.equal(r.json.meta.cached, false);
  assert.equal(r.json.meta.freshnessStatus, "FRESH");
  assert.equal(r.json.meta.stale, false);
  assert.equal(typeof r.json.meta.requestId, "string");
  assert.ok(seen[0][0].startsWith("https://api.fugle.tw/marketdata/v1.0/stock/intraday/quote/2330"));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].domainCode, "OK");
  assert.ok(!JSON.stringify(logs).toLowerCase().includes("dummy-key"));
});

test("bars success validates range and maps ascending bars", async () => {
  const { proxy } = testProxy(async () => okJson(BARS_UPSTREAM));
  const r = await call(proxy, "GET", "/api/market/bars?symbol=0050&from=2023-02-06&to=2023-02-09");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.data.map((b) => b.c), [119.0, 119.0, 120.85, 120.9]);
  assert.equal(r.json.meta.dataKind, "historical");
  assert.equal(r.json.meta.adjustmentMode, "unadjusted");
  const badRange = await call(proxy, "GET", "/api/market/bars?symbol=0050&from=2023-02-09&to=2023-02-06");
  assert.equal(badRange.status, 400);
  assert.equal(badRange.json.error.code, "DATA_INVALID");
  const badSymbol = await call(proxy, "GET", "/api/market/quote?symbol=bad!!");
  assert.equal(badSymbol.status, 400);
});

test("realtime quote freshness follows the 7A policy, not a constant", async () => {
  const late = testProxy(async () => okJson(QUOTE_UPSTREAM), { clock: () => 1685338201000 + 120_000 });
  const stale = await call(late.proxy, "GET", "/api/market/quote?symbol=2330");
  assert.equal(stale.status, 200);
  assert.equal(stale.json.meta.freshnessStatus, "STALE");
  assert.equal(stale.json.meta.stale, true);
  assert.ok(stale.json.meta.freshnessMs > 30_000);
});

test("calendar-year range rejects exactly-one-year spans", async () => {
  const { proxy } = testProxy(async () => okJson(BARS_UPSTREAM));
  for (const [from, to, status] of [
    ["2024-01-01", "2024-12-31", 200],
    ["2023-12-31", "2024-12-31", 400],
    ["2025-01-01", "2026-01-01", 400],
  ]) {
    const r = await call(proxy, "GET", `/api/market/bars?symbol=0050&from=${from}&to=${to}`);
    assert.equal(r.status, status, `${from}~${to}`);
    if (status === 400) assert.equal(r.json.error.code, "DATA_INVALID");
  }
});

test("upstream failures map to stable codes without leaking", async () => {
  for (const [step, status, code] of [
    [{ status: 401, body: { msg: "x" } }, 502, "AUTH_FAILED"],
    [{ status: 404, body: {} }, 404, "INVALID_SYMBOL"],
    [{ status: 500, body: "boom" }, 502, "PROVIDER_UNAVAILABLE"],
    [{ status: 200, body: "{not json", raw: true }, 502, "DATA_INVALID"],
    [{ status: 200, body: { nope: 1 } }, 502, "DATA_INVALID"],
  ]) {
    const { proxy } = testProxy(async () => ({
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      headers: { get: () => null },
      async json() { if (step.raw) throw new SyntaxError("bad"); return step.body; },
    }));
    const r = await call(proxy, "GET", "/api/market/quote?symbol=2330");
    assert.equal(r.status, status);
    assert.equal(r.json.error.code, code);
    assert.ok(!JSON.stringify(r.json).includes("boom"));
  }
});

test("429 retries with Retry-After then succeeds", async () => {
  const sleeps = [];
  let calls = 0;
  const { proxy, logs } = testProxy(async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 429, headers: { get: (n) => (n === "retry-after" ? "2" : null) }, async json() { return {}; } };
    }
    return okJson(QUOTE_UPSTREAM);
  }, { sleep: async (ms) => { sleeps.push(ms); } });
  const r = await call(proxy, "GET", "/api/market/quote?symbol=2330");
  assert.equal(r.status, 200);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [2000]);
  assert.equal(logs[0].attempts, 2);
});

test("timeout maps to TIMEOUT and never hangs", async () => {
  const { proxy } = testProxy(() => new Promise(() => {}), { timeoutMs: 30 });
  const r = await call(proxy, "GET", "/api/market/quote?symbol=2330");
  assert.equal(r.status, 504);
  assert.equal(r.json.error.code, "TIMEOUT");
});

test("only GET is served; open-proxy paths impossible", async () => {
  const { proxy } = testProxy(async () => okJson(QUOTE_UPSTREAM));
  const post = await call(proxy, "POST", "/api/market/quote?symbol=2330");
  assert.equal(post.status, 405);
  const unknown = await call(proxy, "GET", "/api/proxy?url=https://evil.invalid");
  assert.equal(unknown.status, 404);
  const root = await call(proxy, "GET", "/");
  assert.equal(root.status, 404);
});

test("CORS allowlist: pages and localhost pass, wildcard and evil fail", async () => {
  const { proxy } = testProxy(async () => okJson(QUOTE_UPSTREAM));
  const pages = await call(proxy, "GET", "/api/market/quote?symbol=2330", { origin: "https://waydefu.github.io" });
  assert.equal(pages.headers["access-control-allow-origin"], "https://waydefu.github.io");
  const local = await call(proxy, "GET", "/api/market/quote?symbol=2330", { origin: "http://127.0.0.1:5500" });
  assert.equal(local.headers["access-control-allow-origin"], "http://127.0.0.1:5500");
  const evil = await call(proxy, "GET", "/api/market/quote?symbol=2330", { origin: "https://evil.invalid" });
  assert.ok(!("access-control-allow-origin" in evil.headers));
  assert.ok(!Object.values(pages.headers).includes("*"));
});

test("loopback integration serves real HTTP without external network", async () => {
  const proxy = createProxy({
    apiKey: "dummy-key-for-tests-only",
    fetchImpl: stubFetch(async () => okJson(QUOTE_UPSTREAM)),
    logger: () => {},
    sleep: async () => {},
  });
  const running = await proxy.start(0, "127.0.0.1");
  try {
    const res = await fetch(`${running.url}/api/market/quote?symbol=2330`, { headers: { origin: "https://waydefu.github.io" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "https://waydefu.github.io");
    const body = await res.json();
    assert.equal(body.data.price, 568);
    assert.equal(body.meta.provider, "FUGLE");
  } finally {
    await running.close();
  }
});

test("per-client token bucket sheds load with 429 instead of hitting upstream", async () => {
  let upstreamCalls = 0;
  const { proxy } = testProxy(async () => {
    upstreamCalls += 1;
    return okJson(QUOTE_UPSTREAM);
  }, { rateLimit: { maxRequests: 2, windowMs: 60_000 }, clock: () => 1000 });
  const first = await call(proxy, "GET", "/api/market/quote?symbol=2330");
  const second = await call(proxy, "GET", "/api/market/quote?symbol=2330");
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const shed = await call(proxy, "GET", "/api/market/quote?symbol=2330");
  assert.equal(shed.status, 429);
  assert.equal(shed.json.error.code, "RATE_LIMITED");
  assert.equal(shed.headers["retry-after"], 30);
  // 第三次被擋下，沒有再打上游（前兩次只有第一次真的打上游：第二次命中 quote 快取）。
  assert.equal(upstreamCalls, 1);
});

test("one client exhausting its bucket never blocks another client", async () => {
  const { proxy } = testProxy(async () => okJson(QUOTE_UPSTREAM), {
    rateLimit: { capacity: 2, refillPerSecond: 1 },
    clock: () => 1000,
  });
  for (let i = 0; i < 3; i += 1) {
    const hit = await call(proxy, "GET", "/api/market/quote?symbol=2330", {}, "10.0.0.1");
    if (i < 2) assert.equal(hit.status, 200);
    else assert.equal(hit.status, 429);
  }
  const other = await call(proxy, "GET", "/api/market/quote?symbol=2330", {}, "10.0.0.2");
  assert.equal(other.status, 200);
});

test("client key ignores X-Forwarded-For unless TRUST_PROXY is on", async () => {
  const untrusted = testProxy(async () => okJson(QUOTE_UPSTREAM), {
    rateLimit: { capacity: 1, refillPerSecond: 1 },
    clock: () => 1000,
  });
  const first = await call(untrusted.proxy, "GET", "/api/market/quote?symbol=2330", { "x-forwarded-for": "203.0.113.9" }, "10.0.0.1");
  const spoofed = await call(untrusted.proxy, "GET", "/api/market/quote?symbol=2330", { "x-forwarded-for": "203.0.113.9" }, "10.0.0.1");
  assert.equal(first.status, 200);
  assert.equal(spoofed.status, 429, "未開 TRUST_PROXY 時，X-Forwarded-For 不得改變 client bucket");

  const trusted = testProxy(async () => okJson(QUOTE_UPSTREAM), {
    rateLimit: { capacity: 1, refillPerSecond: 1 },
    clock: () => 1000,
    trustProxy: true,
  });
  const viaProxyA = await call(trusted.proxy, "GET", "/api/market/quote?symbol=2330", { "x-forwarded-for": "203.0.113.9" }, "10.0.0.1");
  const viaProxyB = await call(trusted.proxy, "GET", "/api/market/quote?symbol=2330", { "x-forwarded-for": "203.0.113.10" }, "10.0.0.1");
  assert.equal(viaProxyA.status, 200);
  assert.equal(viaProxyB.status, 200, "TRUST_PROXY=1 時依 X-Forwarded-For 第一段分流");
});

test("quote cache serves the same symbol from cache inside the TTL", async () => {
  let upstreamCalls = 0;
  let now = 1_000;
  const { proxy } = testProxy(async () => {
    upstreamCalls += 1;
    return okJson(QUOTE_UPSTREAM);
  }, { clock: () => now, quoteCacheTtlMs: 4_000 });
  const first = await call(proxy, "GET", "/api/market/quote?symbol=2330");
  assert.equal(first.status, 200);
  assert.equal(first.json.meta.cached, false);
  const second = await call(proxy, "GET", "/api/market/quote?symbol=2330");
  assert.equal(second.status, 200);
  assert.equal(second.json.meta.cached, true);
  assert.equal(second.json.data.price, 568);
  assert.equal(upstreamCalls, 1, "TTL 內同代碼只打一次上游");

  now += 5_000;
  const third = await call(proxy, "GET", "/api/market/quote?symbol=2330");
  assert.equal(third.status, 200);
  assert.equal(third.json.meta.cached, false);
  assert.equal(upstreamCalls, 2, "TTL 過期後重新打上游");
});

test("daily upstream budget sheds with 429 and stops calling upstream", async () => {
  let upstreamCalls = 0;
  const { proxy, logs } = testProxy(async () => {
    upstreamCalls += 1;
    return okJson(QUOTE_UPSTREAM);
  }, { dailyUpstreamBudget: 2, clock: () => 1_700_000_000_000 });
  await call(proxy, "GET", "/api/market/quote?symbol=2330");
  await call(proxy, "GET", "/api/market/quote?symbol=2331");
  const budgeted = await call(proxy, "GET", "/api/market/quote?symbol=2332");
  assert.equal(budgeted.status, 429);
  assert.equal(budgeted.json.error.code, "RATE_LIMITED");
  assert.equal(upstreamCalls, 2, "預算用盡後不得再打上游");
  assert.ok(logs.some((entry) => entry.domainCode === "RATE_LIMITED"));
});

test("logs carry a hashed client id and never the raw client key", async () => {
  const { proxy, logs } = testProxy(async () => okJson(QUOTE_UPSTREAM), { clock: () => 1_000 });
  await call(proxy, "GET", "/api/market/quote?symbol=2330", {}, "203.0.113.77");
  assert.equal(logs.length, 1);
  assert.equal(typeof logs[0].clientId, "string");
  assert.ok(!JSON.stringify(logs).includes("203.0.113.77"), "log 不得出現原始 IP");
  assert.equal(logs[0].latencyMs, 0, "latency 用注入的 clock");
});

test("health endpoint reports liveness without secrets or internals", async () => {
  const { proxy } = testProxy(async () => okJson(QUOTE_UPSTREAM));
  const r = await call(proxy, "GET", "/healthz");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { status: "ok", service: "market-proxy" });
  const text = JSON.stringify(r.json).toLowerCase();
  assert.ok(!text.includes("api_key") && !text.includes("env") && !text.includes("secret"));
});
