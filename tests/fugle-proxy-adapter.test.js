import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { ADAPTER_STATUS, DATA_ERROR_CODE, DATA_KINDS, NORMALIZATION_VERSION } from "../js/market-data-contract.js";
import { FugleProxyAdapter } from "../js/fugle-proxy-adapter.js";

const quotePayload = JSON.parse(readFileSync(new URL("./fixtures/fugle/quote-success.json", import.meta.url)));
const barsPayload = JSON.parse(readFileSync(new URL("./fixtures/fugle/historical-success.json", import.meta.url)));

function proxyOk(payload, { status = 200, headers = {}, requestId = "req-1" } = {}) {
  return async (url, init) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  });
}

function envelopeFor(payload, meta) {
  return { data: payload, meta: { provider: "FUGLE", requestId: "req-1", cached: false, ...meta } };
}

test("browser adapter fetches quote through the proxy without secrets", async () => {
  const seen = [];
  const adapter = new FugleProxyAdapter({
    baseUrl: "https://proxy.invalid",
    fetchImpl: async (url, init) => {
      seen.push([url, init]);
      assert.ok(!JSON.stringify(init?.headers ?? {}).toLowerCase().includes("api-key"));
      return proxyOk(envelopeFor(
        { code: "2330", price: 568, prev: 566, chg: 2, pct: 0.35, vol: 54538, t: 1685338200000 },
        { market: "TW", symbol: "2330", dataKind: DATA_KINDS.REALTIME, providerTimestamp: 1685338200000, receivedAt: 1685338200500, freshnessStatus: "FRESH", freshnessMs: 500, stale: false, source: "fugle-quote", normalizationVersion: NORMALIZATION_VERSION, pointInTime: "unknown", adjustmentMode: "unknown" },
      ))(url, init);
    },
    clock: () => 1685338201000,
  });
  const quote = await adapter.quoteAsync("2330");
  assert.equal(quote.data.price, 568);
  assert.equal(quote.data.symbol, "2330");
  assert.equal(quote.meta.provider, "FUGLE");
  assert.equal(quote.meta.requestId, "req-1");
  assert.ok(seen[0][0].startsWith("https://proxy.invalid/api/market/quote?"));
  assert.ok(!seen[0][0].includes("api.fugle.tw"));
  assert.equal(adapter.getStatus().state, ADAPTER_STATUS.READY);
});

test("browser adapter rejects apiKey options and bad symbols", () => {
  assert.throws(() => new FugleProxyAdapter({ baseUrl: "https://proxy.invalid", apiKey: "sk-x" }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
  const adapter = new FugleProxyAdapter({ baseUrl: "https://proxy.invalid", fetchImpl: proxyOk({}), clock: () => 0 });
  return assert.rejects(adapter.quoteAsync("bad symbol!!"), (e) => e.code === DATA_ERROR_CODE.INVALID_SYMBOL);
});

test("browser adapter surfaces proxy errors with stable codes", async () => {
  const failing = new FugleProxyAdapter({
    baseUrl: "https://proxy.invalid",
    fetchImpl: proxyOk({ error: { code: "RATE_LIMITED", message: "slow down", requestId: "req-9" } }, { status: 429, headers: { "retry-after": "2" } }),
    clock: () => 0,
    sleep: async () => {},
  });
  await assert.rejects(failing.quoteAsync("2330"), (e) => e.code === DATA_ERROR_CODE.RATE_LIMITED);
  assert.equal(failing.getStatus().state, ADAPTER_STATUS.RATE_LIMITED);
  const broken = new FugleProxyAdapter({
    baseUrl: "https://proxy.invalid",
    fetchImpl: proxyOk({ nope: true }),
    clock: () => 0,
  });
  await assert.rejects(broken.quoteAsync("2330"), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
});

test("browser adapter validates bars range client-side and returns issues", async () => {
  const adapter = new FugleProxyAdapter({
    baseUrl: "https://proxy.invalid",
    fetchImpl: proxyOk(envelopeFor(
      [
        { t: 1675296000000, o: 119.1, h: 120.2, l: 118.9, c: 119.0, v: 8123456 },
        { t: 1675382400000, o: 119.1, h: 120.5, l: 119.0, c: 119.0, v: 7654321 },
        { t: 1675468800000, o: 120.1, h: 120.95, l: 120.0, c: 120.85, v: 9239321 },
        { t: 1675555200000, o: 120.85, h: 121.0, l: 120.0, c: 120.5, v: 7000000 },
      ],
      { market: "TW", symbol: "0050", dataKind: DATA_KINDS.HISTORICAL, providerTimestamp: 1675468800000, receivedAt: 1675468801000, freshnessStatus: "UNKNOWN", freshnessMs: 1000, stale: false, source: "fugle-bars", normalizationVersion: NORMALIZATION_VERSION, pointInTime: "unknown", adjustmentMode: "unadjusted" },
    )),
    clock: () => 1675468802000,
  });
  const { envelope, issues } = await adapter.getBarsAsync("0050", { from: "2023-02-01", to: "2023-02-08" });
  assert.equal(envelope.data.length, 4);
  assert.deepEqual(issues, []);
  assert.equal(envelope.meta.adjustmentMode, "unadjusted");
  await assert.rejects(adapter.getBarsAsync("0050", { from: "2023-02-08", to: "2023-02-01" }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
});

test("browser adapter honors Retry-After through the full chain", async () => {
  const sleeps = [];
  let calls = 0;
  const adapter = new FugleProxyAdapter({
    baseUrl: "https://proxy.invalid",
    fetchImpl: async (url, init) => {
      calls += 1;
      if (calls === 1) {
        return proxyOk({ error: { code: "RATE_LIMITED", message: "slow", requestId: "r1" } }, { status: 429, headers: { "retry-after": "2" } })(url, init);
      }
      return proxyOk(envelopeFor(
        { code: "2330", price: 568, prev: 566, chg: 2, pct: 0.35, vol: 1, t: 1685338200000 },
        { market: "TW", symbol: "2330", dataKind: DATA_KINDS.REALTIME, providerTimestamp: 1685338200000, receivedAt: 1685338200500, freshnessStatus: "FRESH", freshnessMs: 500, stale: false, source: "f", normalizationVersion: NORMALIZATION_VERSION, pointInTime: "unknown", adjustmentMode: "unknown" },
      ))(url, init);
    },
    clock: () => 1685338201000,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  const quote = await adapter.quoteAsync("2330");
  assert.equal(quote.data.price, 568);
  assert.deepEqual(sleeps, [2000]);
});

test("browser adapter capabilities declare no realtime stream", () => {
  const adapter = new FugleProxyAdapter({ baseUrl: "", fetchImpl: proxyOk({}), clock: () => 0 });
  const cap = adapter.getCapabilities();
  assert.equal(cap.provider, "FUGLE");
  assert.equal(cap.capabilities.realtimeStream, false);
  assert.equal(cap.auth, "server-held");
  assert.equal(adapter.getStatus().state, ADAPTER_STATUS.DISCONNECTED);
  assert.equal(adapter.describe().dataKind, null);
});
