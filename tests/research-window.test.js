import assert from "node:assert/strict";
import test from "node:test";
import { evaluateWindow, parameterSurface, runResearchBacktest } from "../js/research.js";
import { makeTrendStrategy } from "../js/alpha.js";
import { fixedFraction } from "../js/portfolio.js";

function trendBars(n, start = 100, step = 0.5, t0 = 1_000_000) {
  return Array.from({ length: n }, (_, i) => {
    const c = start + i * step;
    return { t: t0 + i * 86_400_000, o: c - 0.1, h: c + 0.2, l: c - 0.2, c, v: 1000 };
  });
}

const strategy = () => makeTrendStrategy({});
const args = (contextBars, evalBars) => ({
  symbol: "2330",
  strategy: strategy(),
  allocate: fixedFraction(0.25),
  contextBars,
  evalBars,
});

test("first evaluation bar sees warmup context instead of WARMUP silence", () => {
  const contextBars = trendBars(120, 100, 0.5, 1_000_000);
  const evalBars = trendBars(40, 160, 0.5, 1_000_000 + 120 * 86_400_000);
  const result = evaluateWindow(args(contextBars, evalBars));
  assert.equal(result.equity.length, 40);
  assert.ok(result.trades.length > 0);
  assert.ok(result.trades.every((t) => t.entryTime >= evalBars[0].t));
});

test("warmup context never enters PnL, trades, or metrics", () => {
  const contextBars = trendBars(120, 100, 0.5, 1_000_000);
  const evalBars = trendBars(40, 160, 0.0, 1_000_000 + 120 * 86_400_000);
  const result = evaluateWindow(args(contextBars, evalBars));
  assert.equal(result.equity.length, evalBars.length);
  assert.ok(result.trades.every((t) => t.entrySignalIndex >= contextBars.length));
  assert.ok(result.trades.every((t) => t.entryTime >= evalBars[0].t && t.exitTime >= evalBars[0].t));
});

test("future bars cannot change earlier signals (no lookahead)", () => {
  const contextBars = trendBars(120, 100, 0.3, 1_000_000);
  const evalBars = trendBars(40, 136, 0.3, 1_000_000 + 120 * 86_400_000);
  const base = evaluateWindow(args(contextBars, evalBars)).trades.map((t) => t.entrySignalIndex);
  const mutated = evalBars.map((b, i) => (i === 30 ? { ...b, c: b.c * 2, h: b.h * 2, l: b.l * 2, o: b.o * 2 } : b));
  const after = evaluateWindow(args(contextBars, mutated)).trades.map((t) => t.entrySignalIndex);
  assert.deepEqual(after.filter((idx) => idx < 120 + 20), base.filter((idx) => idx < 120 + 20));
});

test("empty context matches the legacy full-run result", () => {
  const bars = trendBars(200, 100, 0.2, 1_000_000);
  const legacy = runResearchBacktest({ symbol: "2330", strategy: strategy(), allocate: fixedFraction(0.25), bars });
  const windowed = evaluateWindow(args([], bars));
  assert.deepEqual(windowed.trades, legacy.trades);
  assert.deepEqual(windowed.equity, legacy.equity);
});

test("window rejects malformed inputs fail-closed", () => {
  const bars = trendBars(150, 100, 0.2, 1_000_000);
  assert.throws(() => evaluateWindow({ ...args(bars.slice(0, 100), bars.slice(100)), evalBars: [] }), /evaluation window/);
  assert.throws(() => evaluateWindow({ ...args(bars.slice(0, 100), bars.slice(100)), strategy: null }), /strategy/);
});

test("surface cells get full warmup context instead of flat-zero STABLE", () => {
  const bars = trendBars(300, 100, 0.4, 1_000_000);
  const beforeTail = bars.slice(0, -60);
  const tail = bars.slice(-60);
  const cells = [10, 20, 30].map((short) => {
    const variant = makeTrendStrategy({ id: `t${short}`, short });
    const result = evaluateWindow({
      symbol: "2330", strategy: variant, allocate: fixedFraction(0.25),
      contextBars: beforeTail.slice(-variant.warmup), evalBars: tail,
    });
    return { params: { short }, value: result.trades.reduce((a, t) => a + t.netPnl, 0), trades: result.trades.length };
  });
  assert.ok(cells.every((c) => c.trades > 0), "each surface cell must leave WARMUP on trending data");
  assert.ok(cells.some((c) => c.value !== 0), "surface must not be degenerate all-zero");
  const surface = parameterSurface(cells.map(({ params, value }) => ({ params, value })));
  assert.equal(typeof surface.overfitRisk, "boolean");
});
