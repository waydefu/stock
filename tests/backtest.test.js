import assert from "node:assert/strict";
import test from "node:test";
import { runBacktest } from "../js/backtest.js";

const bars = [
  { t: 1, o: 100, h: 104, l: 99, c: 102, v: 1000 },
  { t: 2, o: 103, h: 108, l: 102, c: 107, v: 1100 },
  { t: 3, o: 106, h: 107, l: 95, c: 96, v: 1200 },
  { t: 4, o: 95, h: 98, l: 93, c: 94, v: 900 },
];

test("backtest fills a signal at the next bar open, not the signal close", () => {
  const result = runBacktest(bars, ({ i }) => i === 0 ? "buy" : i === 2 ? "sell" : "hold", {
    initialCapital: 10000,
    positionPct: 1,
    commissionRate: 0,
    slippageBps: 0,
  });
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryTime, bars[1].t);
  assert.equal(result.trades[0].entryPrice, bars[1].o);
  assert.equal(result.trades[0].exitTime, bars[3].t);
  assert.equal(result.trades[0].exitPrice, bars[3].o);
});

test("backtest applies commission and slippage to both sides", () => {
  const result = runBacktest(bars, ({ i }) => i === 0 ? "buy" : i === 2 ? "sell" : "hold", {
    initialCapital: 10000,
    positionPct: 1,
    commissionRate: 0.01,
    slippageBps: 100,
  });
  const trade = result.trades[0];
  assert.ok(trade.entryPrice > bars[1].o);
  assert.ok(trade.exitPrice < bars[3].o);
  assert.ok(trade.fees > 0);
  assert.ok(result.metrics.netProfit < 0);
});

test("built-in moving-average strategy returns a complete report", () => {
  const result = runBacktest(bars.concat(bars.map((bar, i) => ({ ...bar, t: i + 5, o: bar.o + 3, h: bar.h + 3, l: bar.l + 3, c: bar.c + 3 }))), "maCross", {
    initialCapital: 10000,
    fast: 2,
    slow: 3,
  });
  assert.ok(Array.isArray(result.equity));
  assert.equal(result.equity.length, 8);
  assert.ok(Number.isFinite(result.metrics.maxDrawdownPct));
  assert.ok(result.metrics.tradeCount >= 0);
});
