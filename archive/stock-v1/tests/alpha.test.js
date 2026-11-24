/* 研究基準策略庫 tests（Slice D）。 */
"use strict";

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { BUY_HOLD_STRATEGY, CASH_STRATEGY, MULTI_HORIZON_TREND, buildDefaultRegistry, horizonScore } from "../js/alpha.js";
import { normalizeSignal, validateStrategy } from "../js/strategy.js";

function synthBars(n, drift) {
  const bars = [];
  let price = 100;
  let t = 1_700_000_000_000;
  for (let i = 0; i < n; i++) {
    price *= 1 + drift;
    bars.push({ t: (t += 86_400_000), o: price, h: price * 1.005, l: price * 0.995, c: price, v: 1000 });
  }
  return bars;
}

describe("baselines", () => {
  it("三個基準都有可驗證定義＋非空假說", () => {
    const reg = buildDefaultRegistry();
    assert.equal(reg.size, 3);
    for (const s of reg.list()) {
      assert.ok(s.hypothesis.length > 10, s.id);
      validateStrategy(reg.get(s.id));
    }
  });

  it("cash 永遠 0 分；buyHold 永遠滿分", () => {
    const bars = synthBars(10, 0.01);
    const cash = normalizeSignal(CASH_STRATEGY.generateSignal({ bars, index: 9, symbol: "T" }), { symbol: "T", timestamp: 1 });
    const bh = normalizeSignal(BUY_HOLD_STRATEGY.generateSignal({ bars, index: 9, symbol: "T" }), { symbol: "T", timestamp: 1 });
    assert.equal(cash.score, 0);
    assert.equal(bh.score, 1);
  });
});

describe("multi-horizon trend", () => {
  it("上漲序列三 horizon 同正、綜合為正；下跌相反", () => {
    const up = synthBars(150, 0.004);
    const down = synthBars(150, -0.004);
    const sUp = MULTI_HORIZON_TREND.generateSignal({ bars: up, index: 149, symbol: "U" });
    const sDown = MULTI_HORIZON_TREND.generateSignal({ bars: down, index: 149, symbol: "D" });
    assert.ok(sUp.score > 0.3, `up.score=${sUp.score}`);
    assert.ok(sDown.score < -0.3, `down.score=${sDown.score}`);
    assert.deepEqual(sUp.reasonCodes, ["TREND_UP"]);
    assert.deepEqual(sDown.reasonCodes, ["TREND_DOWN"]);
    assert.ok(sUp.confidence >= 2 / 3);
  });

  it("資料不足暖機期回 WARMUP 且 0 分", () => {
    const bars = synthBars(50, 0.004);
    const s = MULTI_HORIZON_TREND.generateSignal({ bars, index: 49, symbol: "W" });
    assert.equal(s.score, 0);
    assert.deepEqual(s.reasonCodes, ["WARMUP"]);
  });

  it("不偷看未來：截斷輸入與完整輸入結果一致", () => {
    const full = synthBars(150, 0.004);
    const i = 140;
    const a = MULTI_HORIZON_TREND.generateSignal({ bars: full, index: i, symbol: "L" });
    const b = MULTI_HORIZON_TREND.generateSignal({ bars: full.slice(0, i + 1), index: i, symbol: "L" });
    assert.deepEqual(a, b);
  });

  it("horizonScore 資料不足回 null；零波動回 0", () => {
    assert.equal(horizonScore([1, 2, 3], 20), null);
    const flat = new Array(30).fill(100);
    assert.equal(horizonScore(flat, 20), 0);
  });
});
