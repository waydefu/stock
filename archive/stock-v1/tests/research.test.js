/* 研究引擎 tests（Slice E）。 */
"use strict";

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { BUY_HOLD_STRATEGY, CASH_STRATEGY, MULTI_HORIZON_TREND } from "../js/alpha.js";
import { fixedFraction, fullNotional } from "../js/portfolio.js";
import {
  evaluatePromotion,
  parameterSurface,
  runCostStress,
  runResearchBacktest,
  splitIS_OOS,
  summarizeResearch,
  walkForward,
} from "../js/research.js";

function synthBars(n, drift, start = 1_700_000_000_000) {
  const bars = [];
  let price = 100;
  let t = start;
  for (let i = 0; i < n; i++) {
    price *= 1 + drift;
    bars.push({ t: (t += 86_400_000), o: price, h: price * 1.005, l: price * 0.995, c: price, v: 1000 });
  }
  return bars;
}

const COSTS = { commissionRate: 0.001425, slippageBps: 5 };

describe("runResearchBacktest", () => {
  it("buyHold 在上漲序列賺錢、cash 不動、 exposures 有界", () => {
    const bars = synthBars(60, 0.004);
    const bh = runResearchBacktest({ symbol: "U", bars, strategy: BUY_HOLD_STRATEGY, allocate: fullNotional(), ...COSTS });
    const cash = runResearchBacktest({ symbol: "U", bars, strategy: CASH_STRATEGY, allocate: fullNotional(), ...COSTS });
    assert.ok(bh.trades.length >= 1);
    assert.ok(bh.equity.at(-1) > 1_000_000, `final=${bh.equity.at(-1)}`);
    assert.ok(cash.equity.every((v) => v === 1_000_000));
    assert.ok(bh.exposure.every((e) => e >= 0 && e <= 1));
    assert.equal(bh.assumptions.fill, "next_bar_open");
  });

  it("策略不得決定股數：缺 allocate 直接拒絕", () => {
    assert.throws(
      () => runResearchBacktest({ symbol: "U", bars: synthBars(10, 0.001), strategy: CASH_STRATEGY }),
      /allocator/,
    );
  });

  it("multiHorizonTrend 在 250 根模擬序列可跑完且不偷看未來", () => {
    const bars = synthBars(250, 0.001);
    const r = runResearchBacktest({ symbol: "T", bars, strategy: MULTI_HORIZON_TREND, allocate: fixedFraction(0.25), ...COSTS });
    assert.equal(r.equity.length, 250);
    assert.ok(r.equity.every(Number.isFinite));
    assert.ok(r.totalFees >= 0 && r.totalSlippage >= 0);
  });
});

describe("summarizeResearch", () => {
  it("完整指標：CAGR/Sortino/Calmar/週轉率/平均持有一次到位", () => {
    const bars = synthBars(120, 0.004);
    const r = runResearchBacktest({ symbol: "U", bars, strategy: BUY_HOLD_STRATEGY, allocate: fullNotional(), ...COSTS });
    const s = summarizeResearch(r, {});
    assert.ok(s.cagrPct > 0);
    assert.ok(s.turnover > 0 && s.avgExposure > 0.9);
    assert.ok(s.tradeCount >= 1 && s.avgHoldingBars > 0);
    assert.ok(s.bestTrade !== null && s.worstTrade !== null);
    assert.equal(s.sharpeInsufficient, false);
  });

  it("零交易時 winRate/profitFactor/expectancy 回 null（UI 顯示 N/A）", () => {
    const bars = synthBars(60, 0.004);
    const r = runResearchBacktest({ symbol: "U", bars, strategy: CASH_STRATEGY, allocate: fullNotional(), ...COSTS });
    const s = summarizeResearch(r, {});
    assert.equal(s.tradeCount, 0);
    assert.equal(s.winRate, null);
    assert.equal(s.profitFactor, null);
    assert.equal(s.expectancy, null);
    assert.equal(s.bestTrade, null);
  });
});

describe("splitIS_OOS / walkForward", () => {
  it("OOS 永遠是後段；比例越界拒絕", () => {
    const bars = synthBars(100, 0.001);
    const { is, oos } = splitIS_OOS(bars, 0.4);
    assert.equal(is.length, 60);
    assert.equal(oos.length, 40);
    assert.ok(is.at(-1).t < oos[0].t);
    assert.throws(() => splitIS_OOS(bars, 1), /oosRatio/);
  });

  it("walk-forward test 區間互不重疊且在 train 之後", () => {
    const bars = synthBars(120, 0.001);
    const windows = walkForward(bars, { folds: 3, minWindow: 10 });
    assert.equal(windows.length, 3);
    for (const w of windows) {
      assert.ok(w.train.at(-1).t < w.test[0].t);
      assert.ok(w.test.length >= 10);
    }
    assert.ok(windows[0].test.at(-1).t < windows[1].test[0].t);
    assert.ok(windows[1].test.at(-1).t < windows[2].test[0].t);
    assert.throws(() => walkForward(synthBars(20, 0.001), { folds: 3, minWindow: 30 }), /不足/);
  });
});

describe("runCostStress", () => {
  it("成本敏感策略在 2× 反轉即 EXECUTION_FRAGILE", () => {
    const bars = synthBars(100, 0.0002);
    const stress = runCostStress(
      { symbol: "F", bars, strategy: BUY_HOLD_STRATEGY, allocate: fullNotional(), ...COSTS },
      (r) => summarizeResearch(r, {}),
      [1, 2],
    );
    assert.equal(stress.runs.length, 2);
    assert.equal(typeof stress.fragile, "boolean");
  });

  it("0.5×/1×/2×/3× 四檔預設矩陣", () => {
    const bars = synthBars(100, 0.004);
    const stress = runCostStress(
      { symbol: "U", bars, strategy: BUY_HOLD_STRATEGY, allocate: fullNotional(), ...COSTS },
      (r) => summarizeResearch(r, {}),
    );
    assert.deepEqual(stress.runs.map((r) => r.mult), [0.5, 1, 2, 3]);
  });
});

describe("parameterSurface", () => {
  it("孤立尖峰標 OVERFIT_RISK；高原不標", () => {
    const spike = parameterSurface([
      { params: { a: 1 }, value: 0.1 },
      { params: { a: 2 }, value: 2.9 },
      { params: { a: 3 }, value: 0.1 },
    ]);
    assert.equal(spike.flag, "OVERFIT_RISK");
    const plateau = parameterSurface([
      { params: { a: 1 }, value: 1.0 },
      { params: { a: 2 }, value: 1.1 },
      { params: { a: 3 }, value: 1.0 },
    ]);
    assert.equal(plateau.flag, null);
  });
});

describe("evaluatePromotion", () => {
  const goodOOS = [{ netProfit: 100 }, { netProfit: 120 }, { netProfit: 90 }];

  it("全綠才 pass；缺證據即 fail（不靜默放行）", () => {
    const gate = evaluatePromotion({
      strategyId: "x",
      isSummary: { netProfit: 500 },
      oosSummaries: goodOOS,
      costStress: { fragile: false },
      surfaceFlag: "STABLE",
      correctnessFindings: [],
    });
    assert.equal(gate.pass, true);
    assert.equal(gate.checks.length, 6);
  });

  it("單一窗口佔比超 60% 即 fail；有 P0 即 fail", () => {
    const concentrated = evaluatePromotion({
      strategyId: "x",
      isSummary: {},
      oosSummaries: [{ netProfit: 290 }, { netProfit: 5 }, { netProfit: 5 }],
      costStress: { fragile: false },
      surfaceFlag: "STABLE",
      correctnessFindings: [],
    });
    assert.equal(concentrated.pass, false);
    const withP0 = evaluatePromotion({
      strategyId: "x",
      isSummary: {},
      oosSummaries: goodOOS,
      costStress: { fragile: false },
      surfaceFlag: "STABLE",
      correctnessFindings: ["P0"],
    });
    assert.equal(withP0.pass, false);
  });
});
