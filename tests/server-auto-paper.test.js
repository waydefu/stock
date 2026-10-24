import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { MemoryStorage, PaperBroker } from "../js/paper.js";
import { AuditLog, RiskEngine } from "../js/risk.js";
import { createServerAutoPaperService, resolveServerAutoPaperConfig, serverAutoScheduleDecision } from "../server/auto-paper-service.js";

function bars(count = 150) {
  const end = Date.parse("2026-10-22T05:30:00+08:00");
  const start = end - (count - 1) * 86_400_000;
  return Array.from({ length: count }, (_, i) => {
    const c = 80 + i * 0.3;
    return { t: start + i * 86_400_000, o: c - 0.1, h: c + 0.4, l: c - 0.4, c, v: 100_000 + i };
  });
}

function adapterFixture(now, counter = { bars: 0, quotes: 0 }) {
  return {
    async getBarsAsync(symbol) {
      counter.bars += 1;
      return {
        envelope: {
          data: bars(),
          meta: { provider: "FUGLE", symbol, dataKind: "historical", stale: false, freshnessStatus: "UNKNOWN" },
        },
        issues: [],
      };
    },
    async quoteAsync(symbol) {
      counter.quotes += 1;
      return {
        data: { symbol, market: "TW", price: 100, previousClose: 100, timestamp: now() },
        meta: { provider: "FUGLE", symbol, dataKind: "realtime", stale: false, freshnessStatus: "FRESH" },
      };
    },
  };
}

function passingPromotion() {
  return {
    gate: { pass: true, checks: [{ id: "test", pass: true, detail: "fixture" }] },
    evidence: {
      bars: 150,
      allocation: 0.10,
      oosNetProfit: 1,
      oosTradeCount: 1,
      walkForwardNetProfit: [1, 1, 1],
      costFragile: false,
      surfaceFlag: "STABLE",
      checks: [{ id: "test", pass: true, detail: "fixture" }],
    },
  };
}

function config() {
  return {
    enabled: true,
    stateFile: resolve(tmpdir(), "unused-server-auto-paper-state.json"),
    symbol: "2330",
    intervalMs: 300_000,
  };
}

test("server Auto config is disabled by default and fail-closed when confirmations are missing", () => {
  assert.deepEqual(resolveServerAutoPaperConfig({}), { enabled: false });
  assert.throws(
    () => resolveServerAutoPaperConfig({ AUTO_PAPER_SERVER_ENABLED: "1" }),
    /durable storage/,
  );
  assert.throws(
    () => resolveServerAutoPaperConfig({
      AUTO_PAPER_SERVER_ENABLED: "1",
      AUTO_PAPER_DURABLE_STORAGE_CONFIRMED: "1",
    }),
    /always-on/,
  );
  assert.throws(
    () => resolveServerAutoPaperConfig({
      AUTO_PAPER_SERVER_ENABLED: "1",
      AUTO_PAPER_DURABLE_STORAGE_CONFIRMED: "1",
      AUTO_PAPER_ALWAYS_ON_CONFIRMED: "1",
      AUTO_PAPER_STATE_FILE: "relative.json",
      AUTO_PAPER_SYMBOL: "2330",
    }),
    /絕對路徑/,
  );

  const stateFile = resolve(tmpdir(), "server-auto-paper.json");
  const ready = resolveServerAutoPaperConfig({
    AUTO_PAPER_SERVER_ENABLED: "1",
    AUTO_PAPER_DURABLE_STORAGE_CONFIRMED: "1",
    AUTO_PAPER_ALWAYS_ON_CONFIRMED: "1",
    AUTO_PAPER_STATE_FILE: stateFile,
    AUTO_PAPER_SYMBOL: "2330",
    AUTO_PAPER_INTERVAL_MS: "300000",
  });
  assert.equal(ready.enabled, true);
  assert.equal(ready.stateFile, stateFile);
  assert.equal(ready.symbol, "2330");
  assert.equal(ready.intervalMs, 300_000);
});

test("server Auto runner uses durable state and MATCHING across cycles", async () => {
  const storage = new MemoryStorage();
  let nowMs = Date.parse("2026-10-23T01:10:00.000Z");
  const counter = { bars: 0, quotes: 0 };
  const service = createServerAutoPaperService({
    config: config(),
    proxyBaseUrl: "http://127.0.0.1:8787",
    storage,
    adapter: adapterFixture(() => nowMs, counter),
    clock: () => nowMs,
    promotionEvaluator: passingPromotion,
  });

  const opened = await service.runOnce();
  assert.equal(opened.code, "ORDER_WORKING");
  assert.equal(service.status().lifecycle, "PAPER_ENABLED");

  const broker = new PaperBroker({ storage, now: () => new Date(nowMs).toISOString() });
  const openAccount = broker.snapshot("TW", { "2330": { price: 100 } });
  assert.equal(openAccount.orders[0].status, "OPEN");
  assert.ok(openAccount.reservedCash > 100_000);

  const filled = await service.runOnce();
  assert.equal(filled.code, "EXECUTED");
  const reloadedBroker = new PaperBroker({ storage, now: () => new Date(nowMs).toISOString() });
  const account = reloadedBroker.snapshot("TW", { "2330": { price: 100 } });
  assert.equal(account.orders[0].status, "FILLED");
  assert.equal(account.positions["2330"].qty, 1000);
  assert.equal(counter.bars, 1, "same pre-close phase reuses historical-bar cache");
  assert.equal(counter.quotes, 2);
  const evidence = service.status().evidence;
  assert.equal(evidence.cycleCount, 2);
  assert.equal(evidence.pricedCycleCount, 2);
  assert.equal(evidence.workingOrderCycles, 1);
  assert.equal(evidence.executedCycles, 1);
  assert.equal(evidence.fillCount, 1);
  assert.equal(evidence.sessionDays, 1);
  assert.equal(evidence.startEquity, 1_000_000, "first fill cost must not disappear from return baseline");
  assert.equal(evidence.benchmarkStartPrice, 100);
  assert.equal(evidence.benchmarkEndPrice, 100);
  assert.equal(evidence.buyHoldReturnPct, 0);
  assert.ok(evidence.feesInWindow > 0);
});

test("server Auto promotion failure never arms or asks for a quote", async () => {
  const storage = new MemoryStorage();
  const nowMs = Date.parse("2026-10-23T01:10:00.000Z");
  const counter = { bars: 0, quotes: 0 };
  const service = createServerAutoPaperService({
    config: config(),
    proxyBaseUrl: "http://127.0.0.1:8787",
    storage,
    adapter: adapterFixture(() => nowMs, counter),
    clock: () => nowMs,
    promotionEvaluator: () => ({
      gate: { pass: false, checks: [{ id: "oos", pass: false, detail: "weak" }] },
      evidence: { bars: 150, allocation: 0.10, checks: [{ id: "oos", pass: false, detail: "weak" }] },
    }),
  });

  const result = await service.runOnce();
  assert.equal(result.code, "PROMOTION_GATE_FAIL");
  assert.notEqual(service.status().lifecycle, "PAPER_ENABLED");
  assert.equal(counter.quotes, 0);
  const evidence = service.status().evidence;
  assert.equal(evidence.cycleCount, 1);
  assert.equal(evidence.pricedCycleCount, 0);
  assert.equal(evidence.promotionGateFails, 1);
});

test("failed promotion is cached for the same completed bar and does not re-run research every 5 minutes", async () => {
  const storage = new MemoryStorage();
  let nowMs = Date.parse("2026-10-23T01:10:00.000Z");
  const counter = { bars: 0, quotes: 0 };
  let promotions = 0;
  const service = createServerAutoPaperService({
    config: config(),
    proxyBaseUrl: "http://127.0.0.1:8787",
    storage,
    adapter: adapterFixture(() => nowMs, counter),
    clock: () => nowMs,
    promotionEvaluator: () => {
      promotions += 1;
      return {
        gate: { pass: false, checks: [{ id: "oos", pass: false, detail: "weak" }] },
        evidence: { bars: 150, allocation: 0.10, checks: [{ id: "oos", pass: false, detail: "weak" }] },
      };
    },
  });

  const first = await service.runOnce();
  nowMs += 5 * 60_000;
  const second = await service.runOnce();
  assert.equal(first.code, "PROMOTION_GATE_FAIL");
  assert.equal(second.code, "PROMOTION_GATE_FAIL");
  assert.equal(promotions, 1, "same completed bar must reuse deterministic FAIL");
  assert.equal(counter.bars, 1, "historical bars remain cached in the same market phase");
  assert.equal(counter.quotes, 0);
  assert.equal(service.status().evidence.promotionGateFails, 2, "both attempted market cycles remain visible evidence");
});

test("durable storage failure makes server Auto fatal and stops further cycles", async () => {
  const state = new Map();
  let failWrites = false;
  const storage = {
    getItem(key) { return state.has(key) ? state.get(key) : null; },
    setItem(key, value) {
      if (failWrites) {
        const error = new Error("disk unavailable");
        error.code = "DURABLE_STORAGE_FAILED";
        throw error;
      }
      state.set(key, String(value));
    },
    removeItem(key) { state.delete(key); },
  };
  const nowMs = Date.parse("2026-10-23T01:10:00.000Z");
  const counter = { bars: 0, quotes: 0 };
  const service = createServerAutoPaperService({
    config: config(),
    proxyBaseUrl: "http://127.0.0.1:8787",
    storage,
    adapter: adapterFixture(() => nowMs, counter),
    clock: () => nowMs,
    promotionEvaluator: passingPromotion,
  });
  failWrites = true;
  const first = await service.runOnce();
  assert.equal(first.code, "DURABLE_STORAGE_FAILED");
  assert.equal(first.fatal, true);
  const calls = counter.bars + counter.quotes;
  const second = await service.runOnce();
  assert.equal(second.fatal, true);
  assert.equal(counter.bars + counter.quotes, calls, "fatal service must not keep trading");
});

test("strict RiskEngine and AuditLog propagate persistence failures", () => {
  const bad = {
    getItem() { return null; },
    setItem() { throw new Error("disk down"); },
  };
  const risk = new RiskEngine({}, { storage: bad, strictPersistence: true });
  assert.throws(() => risk.trip("server safety"), /Risk persistence failed/);
  const audit = new AuditLog({ storage: bad, strictPersistence: true });
  assert.throws(() => audit.record("SERVER_TEST", {}), /Audit persistence failed/);
});


test("strict server state rejects corrupt Paper/Risk/Audit children instead of resetting", () => {
  const paperState = new MemoryStorage();
  paperState.setItem("tw-us-stock-paper-v1", "{broken");
  assert.throws(
    () => new PaperBroker({ storage: paperState, strictPersistence: true }),
    (error) => error?.code === "DURABLE_STATE_INVALID",
  );

  const riskState = new MemoryStorage();
  riskState.setItem("tw-us-stock-killswitch-v1", "{broken");
  assert.throws(
    () => new RiskEngine({}, { storage: riskState, strictPersistence: true }),
    (error) => error?.code === "DURABLE_STATE_INVALID",
  );

  const auditState = new MemoryStorage();
  auditState.setItem("tw-us-stock-audit-v1", JSON.stringify({ version: 1, events: [{ nope: true }] }));
  assert.throws(
    () => new AuditLog({ storage: auditState, strictPersistence: true }),
    (error) => error?.code === "DURABLE_STATE_INVALID",
  );
});

test("browser-compatible persistence mode still resets malformed Paper state safely", () => {
  const storage = new MemoryStorage();
  storage.setItem("tw-us-stock-paper-v1", "{broken");
  const broker = new PaperBroker({ storage });
  assert.equal(broker.snapshot("TW").cash, 1_000_000);
});


test("server Auto authority holds an exclusive lease for the durable state file", () => {
  const dir = mkdtempSync(join(tmpdir(), "stock-server-auto-lease-"));
  const stateFile = join(dir, "state.json");
  const cfg = { ...config(), stateFile };
  const adapter = adapterFixture(() => Date.parse("2026-10-23T01:10:00.000Z"));
  let first;
  try {
    first = createServerAutoPaperService({
      config: cfg,
      proxyBaseUrl: "http://127.0.0.1:8787",
      adapter,
      promotionEvaluator: passingPromotion,
    });
    assert.equal(first.status().authorityLease, "HELD");
    assert.throws(
      () => createServerAutoPaperService({
        config: cfg,
        proxyBaseUrl: "http://127.0.0.1:8787",
        adapter,
        promotionEvaluator: passingPromotion,
      }),
      (error) => error?.code === "DURABLE_STORAGE_LOCKED",
    );
    first.stop();
    assert.equal(first.status().authorityLease, "RELEASED");

    const restarted = createServerAutoPaperService({
      config: cfg,
      proxyBaseUrl: "http://127.0.0.1:8787",
      adapter,
      promotionEvaluator: passingPromotion,
    });
    assert.equal(restarted.status().authorityLease, "HELD");
    restarted.stop();
  } finally {
    try { first?.stop(); } catch { /* best effort */ }
    rmSync(dir, { recursive: true, force: true });
  }
});


test("server Auto schedule follows shared TW market sessions and official 2026 holidays", () => {
  assert.equal(serverAutoScheduleDecision(Date.parse("2026-10-23T00:29:59.000Z")).run, false, "08:29:59 Taipei is before pre-market");
  assert.deepEqual(serverAutoScheduleDecision(Date.parse("2026-10-23T00:30:00.000Z")), { run: true, code: "MARKET_SESSION", session: "preMarket" });
  assert.deepEqual(serverAutoScheduleDecision(Date.parse("2026-10-23T01:00:00.000Z")), { run: true, code: "MARKET_SESSION", session: "regular" });
  assert.deepEqual(serverAutoScheduleDecision(Date.parse("2026-10-23T05:25:00.000Z")), { run: true, code: "MARKET_SESSION", session: "preClose" });
  assert.equal(serverAutoScheduleDecision(Date.parse("2026-10-23T05:30:00.000Z")).run, false, "13:30 Taipei is closed");
  assert.equal(serverAutoScheduleDecision(Date.parse("2026-10-24T01:10:00.000Z")).run, false, "Saturday is closed");
  assert.equal(serverAutoScheduleDecision(Date.parse("2026-10-26T01:10:00.000Z")).run, false, "official TWSE substitute holiday is closed");
});

test("closed-market server cycles do not consume Fugle calls or journal capacity", async () => {
  const storage = new MemoryStorage();
  let nowMs = Date.parse("2026-10-23T06:00:00.000Z"); // 14:00 Taipei
  const counter = { bars: 0, quotes: 0 };
  let promotions = 0;
  const service = createServerAutoPaperService({
    config: config(),
    proxyBaseUrl: "http://127.0.0.1:8787",
    storage,
    adapter: adapterFixture(() => nowMs, counter),
    clock: () => nowMs,
    promotionEvaluator: (...args) => {
      promotions += 1;
      return passingPromotion(...args);
    },
  });

  const closed = await service.runOnce();
  assert.equal(closed.code, "MARKET_CLOSED_SKIP");
  assert.equal(closed.skipped, true);
  assert.equal(counter.bars, 0);
  assert.equal(counter.quotes, 0);
  assert.equal(promotions, 0);
  assert.equal(service.status().evidence.cycleCount, 0);
  assert.equal(service.status().lastScheduleDecision.code, "MARKET_CLOSED_SKIP");

  nowMs = Date.parse("2026-10-27T00:30:00.000Z"); // 08:30 Taipei; 10/26 is holiday, 10/27 resumes
  const open = await service.runOnce();
  assert.notEqual(open.code, "MARKET_CLOSED_SKIP");
  assert.equal(counter.bars, 1);
  assert.ok(counter.quotes <= 1);
  assert.equal(promotions, 1);
  assert.equal(service.status().lastScheduleDecision.session, "preMarket");
});
