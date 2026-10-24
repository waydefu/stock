import test from "node:test";
import assert from "node:assert/strict";
import {
  summarizeBuyHold,
  summarizeClosedTrades,
  summarizeDailyRisk,
  summarizeForwardPerformance,
} from "../server/forward-test-metrics.js";

function entry(timestamp, sessionKey, equity, marketPrice = null, fills = []) {
  return {
    timestamp,
    marketPrice,
    account: equity === null ? null : { sessionKey, equity },
    fills,
  };
}

function fill(orderId, side, qty, price, fee = 0) {
  return { orderId, side, qty, price, fee };
}

test("daily risk uses the last equity snapshot per trading session, not every 5-minute cycle", () => {
  const entries = [
    entry("2026-10-27T01:00:00.000Z", "2026-10-27", 900),
    entry("2026-10-27T05:30:00.000Z", "2026-10-27", 1000),
    entry("2026-10-28T05:30:00.000Z", "2026-10-28", 1100),
    entry("2026-10-29T05:30:00.000Z", "2026-10-29", 990),
    entry("2026-10-30T05:30:00.000Z", "2026-10-30", 1039.5),
  ];
  const result = summarizeDailyRisk(entries);
  assert.equal(result.dailyEquitySamples, 4);
  assert.equal(result.dailyReturnSamples, 3);
  assert.equal(result.minRiskSamples, 3);
  assert.ok(Number.isFinite(result.volatilityPct));
  assert.ok(Number.isFinite(result.sharpe));
  assert.ok(Number.isFinite(result.sortino));
  assert.ok(result.sharpe > 0);
  assert.ok(result.sortino > 0);
});

test("daily risk remains null when the forward test has too few daily returns", () => {
  const result = summarizeDailyRisk([
    entry("2026-10-27T05:30:00.000Z", "2026-10-27", 1000),
    entry("2026-10-28T05:30:00.000Z", "2026-10-28", 1010),
  ]);
  assert.equal(result.dailyReturnSamples, 1);
  assert.equal(result.sharpe, null);
  assert.equal(result.sortino, null);
  assert.equal(result.volatilityPct, null);
});

test("closed-trade metrics mirror long-only average-cost accounting", () => {
  const entries = [
    entry("2026-10-27T01:10:00.000Z", "2026-10-27", 1000, 100, [fill("b1", "buy", 10, 100, 10)]),
    entry("2026-10-28T01:10:00.000Z", "2026-10-28", 1180, 120, [fill("s1", "sell", 10, 120, 10)]),
    entry("2026-10-29T01:10:00.000Z", "2026-10-29", 1180, 100, [fill("b2", "buy", 10, 100, 10)]),
    entry("2026-10-30T01:10:00.000Z", "2026-10-30", 1060, 90, [fill("s2", "sell", 10, 90, 10)]),
  ];
  const result = summarizeClosedTrades(entries);
  assert.equal(result.closedTradeCount, 2);
  assert.equal(result.winRate, 50);
  assert.equal(result.grossProfit, 180);
  assert.equal(result.grossLoss, 120);
  assert.equal(result.profitFactor, 1.5);
  assert.equal(result.expectancy, 30);
  assert.equal(result.netClosedPnl, 60);
  assert.equal(result.avgHoldingHours, 24);
  assert.equal(result.openPositionQty, 0);
  assert.equal(result.fillSequenceAnomalies, 0);
});

test("profit factor is explicit null when there are no losing closed trades", () => {
  const result = summarizeClosedTrades([
    entry("2026-10-27T01:10:00.000Z", "2026-10-27", 1000, 100, [fill("b1", "buy", 1, 100)]),
    entry("2026-10-28T01:10:00.000Z", "2026-10-28", 1010, 110, [fill("s1", "sell", 1, 110)]),
  ]);
  assert.equal(result.closedTradeCount, 1);
  assert.equal(result.profitFactor, null);
  assert.equal(result.profitFactorReason, "NO_LOSING_TRADES");
});

test("duplicate fill evidence is de-duplicated by order id", () => {
  const duplicate = fill("same-order", "buy", 10, 100, 0);
  const result = summarizeClosedTrades([
    entry("2026-10-27T01:10:00.000Z", "2026-10-27", 1000, 100, [duplicate]),
    entry("2026-10-27T01:15:00.000Z", "2026-10-27", 1000, 100, [duplicate]),
  ]);
  assert.equal(result.openPositionQty, 10);
  assert.equal(result.closedTradeCount, 0);
});

test("buy-and-hold comparison uses the same evidence window", () => {
  const entries = [
    entry("2026-10-27T01:10:00.000Z", "2026-10-27", 1000, 100),
    entry("2026-10-28T01:10:00.000Z", "2026-10-28", 1050, 110),
  ];
  const result = summarizeBuyHold(entries, 5);
  assert.equal(result.benchmarkStartPrice, 100);
  assert.equal(result.benchmarkEndPrice, 110);
  assert.ok(Math.abs(result.buyHoldReturnPct - 10) < 1e-12);
  assert.ok(Math.abs(result.excessVsBuyHoldPct + 5) < 1e-12);
});

test("combined performance keeps risk, closed-trade and benchmark metrics together", () => {
  const entries = [
    entry("2026-10-27T01:10:00.000Z", "2026-10-27", 1000, 100, [fill("b1", "buy", 1, 100)]),
    entry("2026-10-28T01:10:00.000Z", "2026-10-28", 1010, 105),
    entry("2026-10-29T01:10:00.000Z", "2026-10-29", 1020, 108),
    entry("2026-10-30T01:10:00.000Z", "2026-10-30", 1030, 110, [fill("s1", "sell", 1, 110)]),
  ];
  const result = summarizeForwardPerformance(entries, { strategyReturnPct: 3 });
  assert.equal(result.dailyReturnSamples, 3);
  assert.equal(result.closedTradeCount, 1);
  assert.ok(Math.abs(result.buyHoldReturnPct - 10) < 1e-12);
  assert.ok(Math.abs(result.excessVsBuyHoldPct + 7) < 1e-12);
});
