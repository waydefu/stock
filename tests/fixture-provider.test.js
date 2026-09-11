import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTER_STATUS,
  DATA_ERROR_CODE,
  DATA_KINDS,
  NORMALIZATION_VERSION,
  MarketDataError,
  isRetryableCode,
} from "../js/market-data-contract.js";
import { FixtureProviderAdapter, assertBrowserSafeConfig, createScriptTransport, selectAdapter } from "../js/fixture-provider.js";
import { SimulatedAdapter } from "../js/market-data.js";

const BARS = [
  { t: 1000, o: 10, h: 11, c: 10.5, l: 9.5, v: 100 },
  { t: 2000, o: 10.5, h: 12, c: 11, l: 10, v: 50 },
  { t: 3000, o: 11, h: 11.5, c: 11.2, l: 10.8, v: 60 },
  { t: 4000, o: 11.2, h: 12, c: 11.8, l: 11, v: 70 },
];
const BARS2 = BARS.slice(0, 2);

function okTransport(steps) {
  return createScriptTransport(steps);
}

test("fixture delivers valid quote and bars with provenance", () => {
  const adapter = new FixtureProviderAdapter({
    transport: okTransport([
      { ok: { code: "2330", price: 100, prev: 99, chg: 1, pct: 1.01, vol: 1000, t: 5000 } },
      { ok: { bars: BARS } },
    ]),
    clock: () => 6000,
  });
  const quote = adapter.quote("2330");
  assert.equal(quote.data.price, 100);
  assert.equal(quote.meta.provider, "FIXTURE");
  assert.equal(quote.meta.dataKind, DATA_KINDS.REALTIME);
  assert.equal(quote.meta.normalizationVersion, NORMALIZATION_VERSION);
  assert.equal(quote.meta.stale, false);
  const bars = adapter.getBars("2330");
  assert.deepEqual(bars.envelope.data.map((b) => b.t), [1000, 2000, 3000, 4000]);
  assert.deepEqual(bars.issues, []);
  assert.equal(adapter.getStatus().state, ADAPTER_STATUS.READY);
});

test("fixture maps provider failures to stable codes", () => {
  for (const [step, code] of [
    [{ fail: { httpStatus: 401 } }, DATA_ERROR_CODE.AUTH_FAILED],
    [{ fail: { httpStatus: 429 } }, DATA_ERROR_CODE.RATE_LIMITED],
    [{ fail: { httpStatus: 500 } }, DATA_ERROR_CODE.PROVIDER_UNAVAILABLE],
    [{ fail: { timeout: true } }, DATA_ERROR_CODE.TIMEOUT],
  ]) {
    const adapter = new FixtureProviderAdapter({ transport: okTransport([step]), clock: () => 0 });
    assert.throws(() => adapter.quote("2330"), (e) => e instanceof MarketDataError && e.code === code);
  }
  const limited = new FixtureProviderAdapter({ transport: okTransport([{ fail: { httpStatus: 429 } }]), clock: () => 0 });
  assert.throws(() => limited.quote("2330"), (e) => e.code === DATA_ERROR_CODE.RATE_LIMITED);
  assert.equal(limited.getStatus().state, ADAPTER_STATUS.RATE_LIMITED);
});

test("fixture rejects corrupt bars and missing fields without faking", () => {
  const dup = new FixtureProviderAdapter({ transport: okTransport([{ ok: { bars: [BARS2[0], { ...BARS2[0] }] } }]), clock: () => 0 });
  assert.throws(() => dup.getBars("2330"), (e) => e.code === DATA_ERROR_CODE.DATA_DUPLICATE);
  const ooo = new FixtureProviderAdapter({ transport: okTransport([{ ok: { bars: [BARS2[1], BARS2[0]] } }]), clock: () => 0 });
  assert.throws(() => ooo.getBars("2330"), (e) => e.code === DATA_ERROR_CODE.DATA_OUT_OF_ORDER);
  const drift = new FixtureProviderAdapter({ transport: okTransport([{ ok: { bars: [{ time: 1, open: 2 }] } }]), clock: () => 0 });
  assert.throws(() => drift.getBars("2330"), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
  const noPrice = new FixtureProviderAdapter({ transport: okTransport([{ ok: { code: "2330", prev: 1 } }]), clock: () => 0 });
  assert.throws(() => noPrice.quote("2330"), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
});

test("fixture surfaces stale realtime quotes as DATA_STALE", () => {
  const adapter = new FixtureProviderAdapter({
    transport: okTransport([{ ok: { code: "2330", price: 100, prev: 99, t: 1000 } }]),
    clock: () => 1_000_000,
  });
  assert.throws(() => adapter.quote("2330"), (e) => e.code === DATA_ERROR_CODE.DATA_STALE);
  assert.equal(adapter.getStatus().state, ADAPTER_STATUS.STALE);
});

test("browser-facing adapter config rejects secret-like keys", () => {
  assert.throws(() => assertBrowserSafeConfig({ apiKey: "sk-live" }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
  assert.throws(() => assertBrowserSafeConfig({ secret_key: "x" }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
  assert.throws(() => new FixtureProviderAdapter({ transport: okTransport([]), credentials: { token: "abc" } }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
  assert.doesNotThrow(() => assertBrowserSafeConfig({ username: "user", endpoint: "https://example.invalid" }));
  assert.doesNotThrow(() => assertBrowserSafeConfig({ apiKey: "" }));
});

test("secret guard scans nested configs without hanging on cycles", () => {
  assert.throws(() => assertBrowserSafeConfig({ auth: { apiKey: "secret" } }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
  assert.throws(() => assertBrowserSafeConfig({ list: [{ token: "abc" }] }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
  const cyclic = { name: "ok" };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => assertBrowserSafeConfig(cyclic));
});

test("selectAdapter never silently falls back to simulation", () => {
  const sim = selectAdapter("simulation");
  assert.ok(sim instanceof SimulatedAdapter);
  assert.throws(() => selectAdapter("fugle"), (e) => e.code === DATA_ERROR_CODE.UNSUPPORTED_CAPABILITY);
  const failing = new FixtureProviderAdapter({ transport: okTransport([{ fail: { httpStatus: 500 } }]), clock: () => 0 });
  assert.throws(() => failing.quote("2330"));
  assert.notEqual(failing.getStatus().state, ADAPTER_STATUS.READY);
  assert.equal(isRetryableCode(DATA_ERROR_CODE.PROVIDER_UNAVAILABLE), true);
});

test("SimulatedAdapter keeps legacy shapes and adds envelope contracts", () => {
  const adapter = new SimulatedAdapter();
  const legacy = adapter.quote("2330");
  assert.ok(Number.isFinite(legacy.price) && Number.isFinite(legacy.pct));
  assert.ok(Array.isArray(adapter.getBars("2330")));
  assert.equal(adapter.getSource().kind, "simulation");
  const cap = adapter.getCapabilities();
  assert.equal(cap.provider, "SIMULATED");
  assert.deepEqual(cap.markets, ["TW", "US"]);
  assert.equal(cap.capabilities.realtimeStream, false);
  assert.equal(adapter.getStatus().state, ADAPTER_STATUS.READY);
  const described = adapter.describe();
  assert.equal(described.provider, "SIMULATED");
  assert.equal(described.dataKind, DATA_KINDS.SIMULATION);
  assert.equal(described.normalizationVersion, NORMALIZATION_VERSION);
  const qe = adapter.quoteEnvelope("2330", { receivedAt: 100, now: 100 });
  assert.equal(qe.data.symbol, "2330");
  assert.ok([qe.meta.freshnessStatus].length === 1);
  const be = adapter.getBarsEnvelope("2330");
  assert.ok(be.envelope.data.length > 0);
  assert.deepEqual(be.issues, []);
});
