import test from "node:test";
import assert from "node:assert/strict";
import { BUY_HOLD_STRATEGY } from "../js/alpha.js";
import { fullNotional } from "../js/portfolio.js";
import { runResearchBacktest } from "../js/research.js";

function bar(t, o, c) {
  return { t, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 1000 };
}

test("next-bar fill must not rewrite the signal bar equity with future open data", () => {
  const common = [
    bar(1, 100, 100),
    bar(2, 100, 100),
    bar(3, 100, 100),
  ];
  const shocked = [
    bar(1, 100, 100),
    bar(2, 200, 200),
    bar(3, 200, 200),
  ];

  const run = (bars) => runResearchBacktest({
    symbol: "2330",
    bars,
    strategy: BUY_HOLD_STRATEGY,
    allocate: fullNotional(),
    initialCapital: 1_000_000,
    commissionRate: 0,
    slippageBps: 0,
  });

  const base = run(common);
  const changedFutureOpen = run(shocked);

  assert.equal(base.trades[0].entryTime, 2);
  assert.equal(changedFutureOpen.trades[0].entryTime, 2);
  assert.equal(base.equity[0], 1_000_000);
  assert.equal(changedFutureOpen.equity[0], 1_000_000);
});

test("next-bar exit must not be reflected one bar before the exit occurs", () => {
  const strategy = {
    id: "timeline-roundtrip",
    name: "timeline roundtrip",
    version: "1.0.0",
    hypothesis: "test execution timing only",
    requiredData: ["ohlcv:daily"],
    warmup: 0,
    parameters: {},
    generateSignal({ index }) {
      if (index === 0) return { score: 1, confidence: 1, reasonCodes: ["ENTER"] };
      if (index === 1) return { score: -1, confidence: 1, reasonCodes: ["EXIT"] };
      return { score: 0, confidence: 1, reasonCodes: ["HOLD"] };
    },
  };
  const bars = [
    bar(1, 100, 100),
    bar(2, 100, 150),
    bar(3, 50, 50),
  ];

  const result = runResearchBacktest({
    symbol: "2330",
    bars,
    strategy,
    allocate: fullNotional(),
    initialCapital: 1_000_000,
    commissionRate: 0,
    slippageBps: 0,
  });

  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].entryTime, 2);
  assert.equal(result.trades[0].exitTime, 3);
  assert.equal(result.equity[1], 1_500_000);
  assert.equal(result.equity[2], 500_000);
});
