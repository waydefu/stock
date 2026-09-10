/* Portfolio 層 tests（Slice E）。 */
"use strict";

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { checkPortfolioLimits, fixedFraction, fullNotional, volatilityTargetScale } from "../js/portfolio.js";

describe("allocators", () => {
  it("fixedFraction 越界拒絕；fullNotional 回 1", () => {
    assert.throws(() => fixedFraction(0), /fraction/);
    assert.throws(() => fixedFraction(1.5), /fraction/);
    assert.equal(fixedFraction(0.25)(), 0.25);
    assert.equal(fullNotional()(), 1);
  });
});

describe("volatilityTargetScale", () => {
  it("波動加倍→曝險減半；低波動被 maxLeverage 封頂", () => {
    assert.equal(volatilityTargetScale(0.3, { targetVol: 0.15, maxLeverage: 1.5 }), 0.5);
    assert.equal(volatilityTargetScale(0.01, { targetVol: 0.15, maxLeverage: 1.5 }), 1.5);
    assert.equal(volatilityTargetScale(0.9, { targetVol: 0.15, maxLeverage: 1.5, minExposure: 0.1 }), 0.16666666666666666);
  });

  it("maxLeverage 無限或缺失直接拒絕", () => {
    assert.throws(() => volatilityTargetScale(0.1, { maxLeverage: Infinity }), /maxLeverage/);
    assert.throws(() => volatilityTargetScale(0.1, { minExposure: 2, maxLeverage: 1 }), /minExposure/);
  });
});

describe("checkPortfolioLimits", () => {
  const limits = { maxSingleExposure: 0.2, maxGrossExposure: 1, maxHoldings: 10, maxDailyLossPct: 2, maxConcentration: 0.6 };

  it("正常組合通過", () => {
    const r = checkPortfolioLimits(
      { positions: [{ symbol: "A", marketValue: 100 }, { symbol: "B", marketValue: 100 }], equity: 1000, dailyPnlPct: -0.5 },
      limits,
    );
    assert.equal(r.ok, true);
  });

  it("單一曝險超標＋日損超標同時回 codes", () => {
    const r = checkPortfolioLimits(
      { positions: [{ symbol: "A", marketValue: 500 }], equity: 1000, dailyPnlPct: -3 },
      limits,
    );
    assert.equal(r.ok, false);
    assert.ok(r.violations.includes("SINGLE_EXPOSURE:A"));
    assert.ok(r.violations.includes("MAX_DAILY_LOSS"));
  });

  it("equity 非正直接 INVALID_EQUITY；持倉數超標回 MAX_HOLDINGS", () => {
    assert.deepEqual(checkPortfolioLimits({ positions: [], equity: 0 }, limits).violations, ["INVALID_EQUITY"]);
    const many = Array.from({ length: 11 }, (_, i) => ({ symbol: `S${i}`, marketValue: 10 }));
    const r = checkPortfolioLimits({ positions: many, equity: 10000 }, limits);
    assert.ok(r.violations.includes("MAX_HOLDINGS"));
  });
});
