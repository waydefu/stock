import assert from "node:assert/strict";
import test from "node:test";
import {
  ADAPTER_STATUS,
  DATA_ERROR_CODE,
  DATA_KINDS,
  FRESHNESS,
  NORMALIZATION_VERSION,
  MarketDataError,
  classifyBars,
  computeBackoff,
  describeCapability,
  describeRateLimit,
  evaluateFreshness,
  isLessThanOneCalendarYear,
  isRetryableCode,
  mapTransportStatus,
  normalizeBars,
  normalizeQuote,
  parseRetryAfterMs,
  retryOperation,
  validateBars,
  wrapEnvelope,
} from "../js/market-data-contract.js";

test("capability contract requires provider identity and freezes", () => {
  const cap = describeCapability({
    provider: "SIMULATED",
    markets: ["TW", "US"],
    capabilities: { quote: true, historicalBars: true, realtimeStream: false, snapshot: true, corporateActions: false, fundamentals: false },
    dataKinds: ["simulation"],
    transport: "local",
    auth: "none",
  });
  assert.equal(cap.provider, "SIMULATED");
  assert.ok(Object.isFrozen(cap));
  assert.throws(() => describeCapability({ markets: ["TW"] }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
});

test("envelope preserves provenance and normalization version", () => {
  const env = wrapEnvelope({ price: 100 }, {
    provider: "SIMULATED", market: "TW", symbol: "2330", dataKind: DATA_KINDS.SIMULATION,
    providerTimestamp: null, receivedAt: 1000, source: "local-generator", now: 1000,
  });
  assert.equal(env.meta.provider, "SIMULATED");
  assert.equal(env.meta.receivedAt, 1000);
  assert.equal(env.meta.dataKind, DATA_KINDS.SIMULATION);
  assert.equal(env.meta.normalizationVersion, NORMALIZATION_VERSION);
  assert.ok(Object.isFrozen(env) && Object.isFrozen(env.meta));
});

test("normalized quote keeps compatibility and nulls unknowns instead of faking", () => {
  const env = wrapEnvelope(null, { provider: "P", market: "TW", symbol: "2330", dataKind: DATA_KINDS.SIMULATION, receivedAt: 1, source: "s", now: 1 });
  assert.equal(env.data, null);
  const q = normalizeQuote({ code: "2330", price: 100.5, prev: 100, chg: 0.5, pct: 0.5 }, { market: "TW" });
  assert.deepEqual(
    { symbol: q.symbol, market: q.market, price: q.price, previousClose: q.previousClose, change: q.change, changePct: q.changePct, volume: q.volume, timestamp: q.timestamp },
    { symbol: "2330", market: "TW", price: 100.5, previousClose: 100, change: 0.5, changePct: 0.5, volume: null, timestamp: null },
  );
  const derived = normalizeQuote({ code: "2330", price: 102, prev: 100 }, { market: "TW" });
  assert.equal(derived.change, 2);
  assert.equal(derived.changePct, 2);
  assert.throws(() => normalizeQuote({ code: "2330" }, { market: "TW" }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
  assert.throws(() => normalizeQuote({ code: "", price: 1 }, { market: "TW" }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
});

test("bars validation enforces ascending timestamps and OHLC invariants", () => {
  const good = [{ t: 1, o: 10, h: 11, c: 10.5, l: 9.5, v: 100 }, { t: 2, o: 10.5, h: 12, c: 11, l: 10, v: 50 }];
  assert.equal(validateBars(good).ok, true);
  assert.equal(validateBars([good[0], { ...good[0] }]).code, DATA_ERROR_CODE.DATA_DUPLICATE);
  assert.equal(validateBars([good[1], good[0]]).code, DATA_ERROR_CODE.DATA_OUT_OF_ORDER);
  assert.equal(validateBars([{ ...good[0], h: 1 }]).code, DATA_ERROR_CODE.DATA_INVALID);
  assert.equal(validateBars([{ ...good[0], v: -1 }]).code, DATA_ERROR_CODE.DATA_INVALID);
  assert.equal(validateBars("nope").code, DATA_ERROR_CODE.DATA_INVALID);
  assert.deepEqual(normalizeBars(good).map((b) => b.t), [1, 2]);
  assert.throws(() => normalizeBars([good[1], good[0]]), (e) => e.code === DATA_ERROR_CODE.DATA_OUT_OF_ORDER);
});

test("bar gaps are classified, unknown when calendar context is insufficient", () => {
  const steady = [1, 2, 3, 4, 5].map((t) => ({ t, o: 1, h: 1, c: 1, l: 1, v: 1 }));
  assert.deepEqual(classifyBars(steady), []);
  const gapped = [...steady, { t: 20, o: 1, h: 1, c: 1, l: 1, v: 1 }];
  assert.equal(classifyBars(gapped)[0].code, DATA_ERROR_CODE.DATA_GAP);
  const tiny = [{ t: 1, o: 1, h: 1, c: 1, l: 1, v: 1 }, { t: 50, o: 1, h: 1, c: 1, l: 1, v: 1 }];
  assert.equal(classifyBars(tiny)[0].code, DATA_ERROR_CODE.UNKNOWN_GAP);
});

test("freshness policy returns FRESH STALE UNKNOWN, never bare boolean", () => {
  const now = 1_000_000;
  const fresh = evaluateFreshness({ providerTimestamp: now - 5_000, receivedAt: now - 5_000, now, dataKind: DATA_KINDS.REALTIME });
  assert.equal(fresh.status, FRESHNESS.FRESH);
  assert.ok(fresh.thresholdMs > 0 && fresh.ageMs === 5_000);
  const stale = evaluateFreshness({ providerTimestamp: now - 120_000, receivedAt: now - 120_000, now, dataKind: DATA_KINDS.REALTIME });
  assert.equal(stale.status, FRESHNESS.STALE);
  assert.equal(evaluateFreshness({ providerTimestamp: null, receivedAt: now, now, dataKind: DATA_KINDS.REALTIME }).status, FRESHNESS.UNKNOWN);
  assert.equal(evaluateFreshness({ providerTimestamp: now + 60_000, receivedAt: now, now, dataKind: DATA_KINDS.REALTIME }).status, FRESHNESS.UNKNOWN);
  assert.equal(evaluateFreshness({ providerTimestamp: now - 10_000_000, receivedAt: now, now, dataKind: DATA_KINDS.HISTORICAL }).status, FRESHNESS.UNKNOWN);
  assert.equal(evaluateFreshness({ providerTimestamp: null, receivedAt: now, now, dataKind: DATA_KINDS.SIMULATION }).status, FRESHNESS.UNKNOWN);
  assert.equal(evaluateFreshness({ providerTimestamp: now - 3_600_000, receivedAt: now - 3_600_000, now, dataKind: DATA_KINDS.SIMULATION }).status, FRESHNESS.FRESH);
});

test("calendar-year range comparison follows exchange semantics", () => {
  assert.equal(isLessThanOneCalendarYear("2024-01-01", "2024-12-31"), true);
  assert.equal(isLessThanOneCalendarYear("2023-12-31", "2024-12-31"), false);
  assert.equal(isLessThanOneCalendarYear("2025-01-01", "2026-01-01"), false);
  assert.equal(isLessThanOneCalendarYear("2024-06-01", "2025-05-31"), true);
  assert.equal(isLessThanOneCalendarYear("2024-02-29", "2025-02-28"), true);
});

test("transport failures map to stable domain errors, never raw HTTP", () => {
  assert.equal(mapTransportStatus({ httpStatus: 401 }).code, DATA_ERROR_CODE.AUTH_FAILED);
  assert.equal(mapTransportStatus({ httpStatus: 403 }).code, DATA_ERROR_CODE.AUTH_FAILED);
  assert.equal(mapTransportStatus({ httpStatus: 429 }).code, DATA_ERROR_CODE.RATE_LIMITED);
  assert.equal(mapTransportStatus({ httpStatus: 500 }).code, DATA_ERROR_CODE.PROVIDER_UNAVAILABLE);
  assert.equal(mapTransportStatus({ timeout: true }).code, DATA_ERROR_CODE.TIMEOUT);
  assert.equal(mapTransportStatus({ networkError: true }).code, DATA_ERROR_CODE.PROVIDER_UNAVAILABLE);
  assert.ok(mapTransportStatus({ httpStatus: 429 }) instanceof MarketDataError);
});

test("retry classifier retries only transient failures", () => {
  for (const code of [DATA_ERROR_CODE.RATE_LIMITED, DATA_ERROR_CODE.TIMEOUT, DATA_ERROR_CODE.PROVIDER_UNAVAILABLE]) {
    assert.equal(isRetryableCode(code), true, code);
  }
  for (const code of [DATA_ERROR_CODE.AUTH_FAILED, DATA_ERROR_CODE.AUTH_REQUIRED, DATA_ERROR_CODE.INVALID_SYMBOL, DATA_ERROR_CODE.UNSUPPORTED_CAPABILITY, DATA_ERROR_CODE.DATA_INVALID]) {
    assert.equal(isRetryableCode(code), false, code);
  }
});

test("backoff is bounded exponential with injectable jitter", () => {
  const noJitter = { baseDelayMs: 1000, maxDelayMs: 8000, jitterMs: 0, random: () => 0 };
  assert.deepEqual([1, 2, 3, 4, 5].map((a) => computeBackoff(a, noJitter)), [1000, 2000, 4000, 8000, 8000]);
  assert.equal(computeBackoff(1, { ...noJitter, jitterMs: 500, random: () => 0.5 }), 1250);
  assert.equal(computeBackoff(5, { baseDelayMs: 1000, maxDelayMs: 8000, jitterMs: 500, random: () => 1 }), 8000);
  assert.ok(computeBackoff(4, { baseDelayMs: 1000, maxDelayMs: 8000, jitterMs: 9999, random: () => 1 }) <= 8000);
});

test("retryOperation is bounded and records sleeps without real timers", async () => {
  let calls = 0;
  const sleeps = [];
  const result = await retryOperation(async () => {
    calls += 1;
    if (calls < 3) throw new MarketDataError(DATA_ERROR_CODE.RATE_LIMITED, "limited");
    return "ok";
  }, { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 8000, random: () => 0, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(result.value, "ok");
  assert.equal(result.attempts, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
  let authCalls = 0;
  await assert.rejects(
    retryOperation(async () => { authCalls += 1; throw new MarketDataError(DATA_ERROR_CODE.AUTH_FAILED, "no"); }, { sleep: async () => {} }),
    (e) => e.code === DATA_ERROR_CODE.AUTH_FAILED,
  );
  assert.equal(authCalls, 1);
});

test("retryOperation prefers server Retry-After over computed backoff", async () => {
  const sleeps = [];
  let calls = 0;
  const result = await retryOperation(async () => {
    calls += 1;
    if (calls === 1) throw new MarketDataError(DATA_ERROR_CODE.RATE_LIMITED, "limited", { retryAfterMs: 2500 });
    return "ok";
  }, { baseDelayMs: 1000, maxDelayMs: 8000, random: () => 0, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(result.value, "ok");
  assert.deepEqual(sleeps, [2500]);
  const capped = [];
  let cappedCalls = 0;
  await retryOperation(async () => {
    cappedCalls += 1;
    if (cappedCalls === 1) throw new MarketDataError(DATA_ERROR_CODE.RATE_LIMITED, "limited", { retryAfterMs: 60_000 });
    return "ok";
  }, { baseDelayMs: 1000, maxDelayMs: 8000, random: () => 0, sleep: async (ms) => { capped.push(ms); } });
  assert.deepEqual(capped, [8000]);
});

test("rate-limit descriptor prefers Retry-After and marks unknowns", () => {
  assert.equal(parseRetryAfterMs({ "retry-after": "3" }, 1000), 3000);
  assert.equal(parseRetryAfterMs({ "Retry-After": new Date(2000).toUTCString() }, 1000), 1000);
  assert.equal(parseRetryAfterMs({}, 1000), null);
  const d = describeRateLimit({ known: false });
  assert.equal(d.known, false);
  assert.equal(d.retryAfterMs, null);
  assert.ok(Object.isFrozen(d));
  assert.ok(Object.isFrozen(ADAPTER_STATUS) && Object.isFrozen(DATA_KINDS) && Object.isFrozen(FRESHNESS));
});
