import test from "node:test";
import assert from "node:assert/strict";
import { AutoPaperRunner } from "../js/auto-paper-runner.js";
import { createAppPaperRuntime } from "../js/paper-runtime.js";
import { MemoryStorage } from "../js/paper.js";
import { fixedFraction } from "../js/portfolio.js";
import { RiskEngine } from "../js/risk.js";
import { reconcileImmediateFill } from "../js/paper-reconciliation.js";

function bar(iso, close) {
  const t = Date.parse(iso);
  return { t, o: close, h: close, l: close, c: close, v: 1000 };
}

function quote(symbol, price, previousClose, now, { stale = false } = {}) {
  return {
    data: { symbol, market: "TW", price, previousClose, change: 0, changePct: 0, volume: 1000, timestamp: now },
    meta: {
      provider: "FUGLE",
      dataKind: "realtime",
      stale,
      freshnessStatus: stale ? "STALE" : "FRESH",
      providerTimestamp: now,
      receivedAt: now,
    },
  };
}

function strategy() {
  return {
    id: "auto-test",
    name: "Auto test",
    version: "1.0.0",
    hypothesis: "test only",
    requiredData: ["ohlcv:daily"],
    warmup: 0,
    parameters: {},
    generateSignal({ bars, index }) {
      return bars[index].c >= 100
        ? { score: 1, confidence: 1, reasonCodes: ["ENTER"] }
        : { score: -1, confidence: 1, reasonCodes: ["EXIT"] };
    },
  };
}

function fixture() {
  const storage = new MemoryStorage();
  let nowMs = Date.parse("2026-10-23T01:10:00.000Z"); // 09:10 Taipei, Friday
  const { broker } = createAppPaperRuntime({ storage, now: () => new Date(nowMs).toISOString() });
  const risk = new RiskEngine({}, { storage, now: () => nowMs });
  const events = [];
  const runner = new AutoPaperRunner({
    strategy: strategy(),
    allocate: fixedFraction(0.10),
    broker,
    risk,
    storage,
    market: "TW",
    symbol: "2330",
    clock: () => nowMs,
    auditEvent: (event, details) => events.push({ event, details }),
  });
  return {
    storage, broker, risk, runner, events,
    setNow(value) { nowMs = Date.parse(value); },
    now() { return nowMs; },
  };
}

test("auto paper requires research approval before arming", () => {
  const f = fixture();
  assert.throws(() => f.runner.arm(), /Promotion Gate/);
  f.runner.recordResearchGate({ pass: true, evidence: { gate: "PASS" } });
  assert.equal(f.runner.status().lifecycle, "RESEARCH_APPROVED");
  f.runner.arm();
  assert.equal(f.runner.status().lifecycle, "PAPER_ENABLED");
});

test("approved runner executes prior completed-bar entry exactly once with risk and fees", async () => {
  const f = fixture();
  f.runner.recordResearchGate({ pass: true, evidence: { gate: "PASS" } });
  f.runner.arm();
  const bars = [
    bar("2026-10-21T05:30:00+08:00", 90),
    bar("2026-10-22T05:30:00+08:00", 110),
  ];
  const first = await f.runner.cycle({
    bars,
    quoteEnvelope: quote("2330", 100, 100, f.now()),
    now: f.now(),
  });
  assert.equal(first.code, "EXECUTED");
  assert.equal(first.fills.length, 1);
  assert.equal(first.fills[0].side, "buy");
  assert.equal(first.fills[0].qty, 1000);
  assert.equal(first.fills[0].lot, "regular");
  assert.ok(first.fills[0].fee > 0);

  const account = f.broker.snapshot("TW", { "2330": { price: 100 } });
  assert.equal(account.positions["2330"].qty, 1000);
  assert.equal(account.orders.length, 1);

  const replay = await f.runner.cycle({
    bars,
    quoteEnvelope: quote("2330", 100, 100, f.now()),
    now: f.now(),
  });
  assert.equal(replay.code, "NO_TARGET_CHANGE");
  assert.equal(f.broker.snapshot("TW", { "2330": { price: 100 } }).orders.length, 1);
});

test("same-day completed signal queues after close and exits on next trading session", async () => {
  const f = fixture();
  f.runner.recordResearchGate({ pass: true, evidence: { gate: "PASS" } });
  f.runner.arm();

  const entryBars = [bar("2026-10-22T05:30:00+08:00", 110)];
  await f.runner.cycle({ bars: entryBars, quoteEnvelope: quote("2330", 100, 100, f.now()), now: f.now() });

  f.setNow("2026-10-23T06:00:00.000Z"); // 14:00 Taipei, Friday
  const exitBars = [
    bar("2026-10-22T05:30:00+08:00", 110),
    bar("2026-10-23T05:30:00+08:00", 90),
  ];
  const queued = await f.runner.cycle({
    bars: exitBars,
    quoteEnvelope: quote("2330", 90, 100, f.now(), { stale: true }),
    now: f.now(),
  });
  assert.equal(queued.code, "WAIT_NEXT_SESSION");
  assert.equal(f.runner.status().pendingIntent.targetBinary, 0);

  f.setNow("2026-10-26T01:10:00.000Z"); // 09:10 Taipei, Monday
  const exit = await f.runner.cycle({
    bars: exitBars,
    quoteEnvelope: quote("2330", 90, 90, f.now()),
    now: f.now(),
  });
  assert.equal(exit.code, "EXECUTED");
  assert.equal(exit.fills[0].side, "sell");
  assert.equal(f.broker.snapshot("TW", { "2330": { price: 90 } }).positions["2330"], undefined);
});

test("freshness blocks execution but preserves pending intent", async () => {
  const f = fixture();
  f.runner.recordResearchGate({ pass: true, evidence: { gate: "PASS" } });
  f.runner.arm();
  const bars = [bar("2026-10-22T05:30:00+08:00", 110)];
  const blocked = await f.runner.cycle({
    bars,
    quoteEnvelope: quote("2330", 100, 100, f.now(), { stale: true }),
    now: f.now(),
  });
  assert.equal(blocked.code, "STALE_QUOTE");
  assert.ok(f.runner.status().pendingIntent);
  assert.equal(f.broker.snapshot("TW", { "2330": { price: 100 } }).orders.length, 0);
});

test("reconciliation detects impossible ledger mutations", () => {
  const before = { cash: 1000, totalFees: 0, positions: {}, orders: [] };
  const fill = { id: "x", clientOrderId: "c", symbol: "2330", side: "buy", qty: 1, price: 100, notional: 100, fee: 1 };
  const after = {
    market: "TW", currency: "TWD", initialCash: 1000, cash: 950,
    marketValue: 100, equity: 1050, realizedPnl: 0, unrealizedPnl: 0, totalPnl: 0,
    totalFees: 1, feeModel: "test", sessionKey: "2026-10-23", sessionOpenEquity: 1000,
    dailyPnl: 50, dailyPnlPct: 5, dailyLossReferenceEquity: 1000,
    positions: { "2330": { symbol: "2330", qty: 1, avgCost: 101, last: 100, marketValue: 100, unrealized: -1 } },
    orders: [fill],
  };
  const result = reconcileImmediateFill({ before, after, fill });
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes("CASH_MISMATCH"));
});
