import test from "node:test";
import assert from "node:assert/strict";
import { evaluateAutoPaperPromotion } from "../js/auto-paper-promotion.js";

function trendBars(count = 232) {
  const start = Date.parse("2025-11-01T05:30:00+08:00");
  return Array.from({ length: count }, (_, i) => {
    const c = 100 + i * 0.25 + Math.sin(i / 7);
    return { t: start + i * 86_400_000, o: c - 0.1, h: c + 0.3, l: c - 0.3, c, v: 1_000_000 + i };
  });
}

test("shared Auto Paper promotion keeps all three walk-forward windows", () => {
  const result = evaluateAutoPaperPromotion({
    symbol: "2330",
    bars: trendBars(),
    commissionRate: 0,
    slippageBps: 0,
  });
  assert.equal(result.oosWindows.length, 3);
  const windowCheck = result.gate.checks.find((check) => check.id === "oos-windows");
  assert.equal(windowCheck.pass, true);
  assert.match(windowCheck.detail, /3/);
  assert.equal(result.allocation, 0.10);
});

test("shared promotion refuses insufficient history instead of padding simulation data", () => {
  assert.throws(
    () => evaluateAutoPaperPromotion({ symbol: "2330", bars: trendBars(149) }),
    /INSUFFICIENT_RESEARCH_HISTORY/,
  );
});
