import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DATA_ERROR_CODE } from "../js/market-data-contract.js";
import { createProxy } from "../server/market-proxy.js";
import { FugleProxyAdapter } from "../js/fugle-proxy-adapter.js";

const QUOTE_UPSTREAM = JSON.parse(readFileSync(new URL("./fixtures/fugle/quote-success.json", import.meta.url)));

function upstreamOk(payload, { status = 200, headers = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: (n) => headers[n.toLowerCase()] ?? null }, async json() { return payload; } };
}

/* In-process transport: browser adapter fetch → proxy handler → stub upstream. */
function proxyTransport(proxy) {
  return async (url, init) => {
    const parsed = new URL(url);
    const req = { method: init?.method ?? "GET", url: parsed.pathname + parsed.search, headers: { origin: "https://waydefu.github.io" } };
    const chunks = [];
    const res = {
      statusCode: 0, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      writeHead(code, h = {}) { this.statusCode = code; for (const [k, v] of Object.entries(h)) this.headers[k.toLowerCase()] = v; },
      end(chunk) { if (chunk) chunks.push(chunk); },
    };
    await proxy.handler(req, res);
    const text = chunks.join("");
    return {
      ok: res.statusCode >= 200 && res.statusCode < 300,
      status: res.statusCode,
      headers: { get: (n) => res.headers[n.toLowerCase()] ?? null },
      async json() { return JSON.parse(text); },
      async text() { return text; },
    };
  };
}

function stackUpstream(handler) {
  return createProxy({ apiKey: "dummy-key-for-tests-only", fetchImpl: handler, logger: () => {}, sleep: async () => {} });
}

test("integration: quote flows browser to proxy to fake upstream", async () => {
  const proxy = stackUpstream(async () => upstreamOk(QUOTE_UPSTREAM));
  const adapter = new FugleProxyAdapter({ baseUrl: "https://proxy.invalid", fetchImpl: proxyTransport(proxy), clock: () => 1685338201000 });
  const quote = await adapter.quoteAsync("2330");
  assert.equal(quote.data.price, 568);
  assert.equal(quote.data.symbol, "2330");
  assert.equal(quote.meta.provider, "FUGLE");
  assert.equal(quote.meta.market, "TW");
  assert.equal(typeof quote.meta.requestId, "string");
});

test("integration: bars flow with historical semantics", async () => {
  const proxy = stackUpstream(async () => upstreamOk({
    symbol: "0050", exchange: "TWSE", market: "TSE", timeframe: "D",
    data: [
      { date: "2023-02-06", open: 119.1, high: 120.2, low: 118.9, close: 119.0, volume: 8123456, change: -0.1 },
      { date: "2023-02-07", open: 119.1, high: 120.5, low: 119.0, close: 119.0, volume: 7654321, change: 0.0 },
      { date: "2023-02-08", open: 120.1, high: 120.95, low: 120.0, close: 120.85, volume: 9239321, change: 1.85 },
      { date: "2023-02-09", open: 120.5, high: 121.0, low: 120.3, close: 120.9, volume: 5032245, change: 0.05 },
    ],
    sort: "asc",
  }));
  const adapter = new FugleProxyAdapter({ baseUrl: "https://proxy.invalid", fetchImpl: proxyTransport(proxy), clock: () => 1675468802000 });
  const { envelope, issues } = await adapter.getBarsAsync("0050", { from: "2023-02-06", to: "2023-02-09" });
  assert.equal(envelope.data.length, 4);
  assert.deepEqual(issues, []);
  assert.equal(envelope.meta.dataKind, "historical");
  assert.equal(envelope.meta.adjustmentMode, "unadjusted");
});

test("integration: upstream 429 recovers end to end", async () => {
  let calls = 0;
  const proxy = stackUpstream(async () => {
    calls += 1;
    if (calls === 1) return upstreamOk({}, { status: 429, headers: { "retry-after": "1" } });
    return upstreamOk(QUOTE_UPSTREAM);
  });
  const adapter = new FugleProxyAdapter({ baseUrl: "https://proxy.invalid", fetchImpl: proxyTransport(proxy), clock: () => 1685338201000, sleep: async () => {} });
  const quote = await adapter.quoteAsync("2330");
  assert.equal(quote.data.price, 568);
  assert.ok(calls >= 2);
});

test("integration: upstream garbage surfaces as DATA_INVALID, never simulation", async () => {
  const proxy = stackUpstream(async () => upstreamOk({ nope: true }));
  const adapter = new FugleProxyAdapter({ baseUrl: "https://proxy.invalid", fetchImpl: proxyTransport(proxy), clock: () => 0 });
  await assert.rejects(adapter.quoteAsync("2330"), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
  assert.notEqual(adapter.getStatus().state, "READY");
});
