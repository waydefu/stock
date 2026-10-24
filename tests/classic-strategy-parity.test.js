import test from "node:test";
import assert from "node:assert/strict";
import { rollingHigh, rsi, sma } from "../js/data.js";
import { classicSignalFor, createClassicStrategy, prepareClassicSignalData } from "../js/classic-strategies.js";
import { runBacktest } from "../js/backtest.js";
import { fixedFraction } from "../js/portfolio.js";
import { runResearchBacktest } from "../js/research.js";

function barsFromCloses(closes) {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1];
    return { t: i + 1, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1000 + i };
  });
}

// Frozen oracle copied from the pre-refactor built-in signal semantics.
// Keep this in tests only so refactors cannot silently redefine historical behavior.
function legacyOracle(strategy, bars, i, options = {}) {
  const closes = bars.map((bar) => bar.c);
  if (strategy === "rsiReversal") {
    const values = rsi(closes, options.rsiLength ?? 14);
    const buyLevel = options.rsiBuy ?? 30;
    const sellLevel = options.rsiSell ?? 70;
    const current = values[i];
    const previous = values[i - 1];
    if (current === null || previous === null || current === undefined || previous === undefined) return "hold";
    if (previous <= buyLevel && current > buyLevel) return "buy";
    if (previous >= sellLevel && current < sellLevel) return "sell";
    return "hold";
  }
  if (strategy === "breakout") {
    const length = options.breakoutLength ?? 20;
    const highs = rollingHigh(closes, length);
    const lows = rollingHigh(closes.map((value) => -value), length).map((value) => value === null ? null : -value);
    if (highs[i] === null || highs[i] === undefined || lows[i] === null || lows[i] === undefined) return "hold";
    if (closes[i] > highs[i]) return "buy";
    if (closes[i] < lows[i]) return "sell";
    return "hold";
  }
  const fast = sma(closes, options.fast ?? 20);
  const slow = sma(closes, options.slow ?? 50);
  if (i < 1 || fast[i] === null || slow[i] === null || fast[i - 1] === null || slow[i - 1] === null) return "hold";
  if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) return "buy";
  if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) return "sell";
  return "hold";
}

const CASES = [
  {
    id: "maCross",
    options: { fast: 3, slow: 5 },
    closes: [100,99,98,97,96,97,98,99,100,101,100,99,98,97,96,97,98,99,100],
  },
  {
    id: "rsiReversal",
    options: { rsiLength: 3, rsiBuy: 30, rsiSell: 70 },
    closes: [100,90,80,70,72,80,90,100,98,90,80,70,72,82,92,102,95,85,75,70,80,90],
  },
  {
    id: "breakout",
    options: { breakoutLength: 3 },
    closes: [100,100,100,100,110,111,112,111,90,89,88,89,100,101,102,80,79,78],
  },
];

for (const spec of CASES) {
  test(`${spec.id} shared signal semantics match the frozen legacy oracle bar-for-bar`, () => {
    const bars = barsFromCloses(spec.closes);
    const prepared = prepareClassicSignalData(spec.id, bars, spec.options);
    const actual = bars.map((_, i) => classicSignalFor(spec.id, bars, i, spec.options, prepared));
    const expected = bars.map((_, i) => legacyOracle(spec.id, bars, i, spec.options));
    assert.deepEqual(actual, expected);
    assert.ok(actual.some((action) => action !== "hold"), "fixture must exercise at least one trade signal");
  });

  test(`${spec.id} layered Strategy adapter preserves legacy trade entries/exits`, () => {
    const bars = barsFromCloses(spec.closes);
    const classic = runBacktest(bars, spec.id, {
      ...spec.options,
      initialCapital: 100_000,
      positionPct: 0.25,
      commissionRate: 0,
      slippageBps: 0,
    });
    const layered = runResearchBacktest({
      symbol: "TEST",
      bars,
      strategy: createClassicStrategy(spec.id, spec.options),
      allocate: fixedFraction(0.25),
      initialCapital: 100_000,
      commissionRate: 0,
      slippageBps: 0,
    });
    const pick = (trade) => ({
      entryTime: trade.entryTime,
      exitTime: trade.exitTime,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      qty: trade.qty,
      netPnl: trade.netPnl,
      entrySignalIndex: trade.entrySignalIndex,
      exitSignalIndex: trade.exitSignalIndex,
      exitReason: trade.exitReason,
    });
    assert.deepEqual(layered.trades.map(pick), classic.trades.map(pick));
    assert.ok(classic.trades.length > 0, "fixture must produce at least one completed trade");
  });
}

test("classic Strategy adapter rejects unknown ids instead of silently inventing semantics", () => {
  assert.throws(() => createClassicStrategy("mystery"), /unknown classic strategy/);
});
