/* Strategy / Signal contract tests（Slice C，先紅後綠）。 */
"use strict";

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  LIFECYCLE,
  StrategyRegistry,
  normalizeSignal,
  signalToTargetWeight,
  transitionLifecycle,
  validateStrategy,
} from "../js/strategy.js";

const VALID_DEF = {
  id: "cash",
  name: "Cash",
  version: "1.0.0",
  hypothesis: "持有現金，不承擔市場風險；所有策略的絕對基準。",
  requiredData: ["ohlcv:daily"],
  warmup: 0,
  parameters: {},
  generateSignal: () => ({ score: 0, confidence: 1, horizon: "none", reasonCodes: ["CASH"], diagnostics: {} }),
};

describe("validateStrategy", () => {
  it("接受完整定義", () => {
    assert.equal(validateStrategy(VALID_DEF), true);
  });

  it("缺 hypothesis 直接拒絕（不准無假說策略）", () => {
    const { hypothesis, ...rest } = VALID_DEF;
    assert.throws(() => validateStrategy(rest), /hypothesis/);
  });

  it("缺 generateSignal 直接拒絕", () => {
    assert.throws(() => validateStrategy({ ...VALID_DEF, generateSignal: "buy" }), /generateSignal/);
  });

  it("warmup 非負整數", () => {
    assert.throws(() => validateStrategy({ ...VALID_DEF, warmup: -1 }), /warmup/);
    assert.throws(() => validateStrategy({ ...VALID_DEF, warmup: 1.5 }), /warmup/);
  });
});

describe("normalizeSignal", () => {
  it("score/confidence 越界自動夾取，不丟錯", () => {
    const s = normalizeSignal({ score: 9, confidence: -2, reasonCodes: ["X"] }, { symbol: "2330", timestamp: 1 });
    assert.equal(s.score, 1);
    assert.equal(s.confidence, 0);
    assert.deepEqual(s.reasonCodes, ["X"]);
    assert.equal(s.version, 1);
  });

  it("非物件 signal 直接拒絕", () => {
    assert.throws(() => normalizeSignal(null, { symbol: "2330", timestamp: 1 }), /物件/);
  });

  it("缺 symbol/timestamp 直接拒絕", () => {
    assert.throws(() => normalizeSignal({ score: 1 }, { symbol: "", timestamp: 1 }), /symbol/);
    assert.throws(() => normalizeSignal({ score: 1 }, { symbol: "2330", timestamp: NaN }), /timestamp/);
  });
});

describe("signalToTargetWeight（long-only，不做空）", () => {
  it("score >= 0.5 → 持有；score <= -0.5 → 退出；中間維持", () => {
    assert.equal(signalToTargetWeight({ score: 0.8 }, 0), 1);
    assert.equal(signalToTargetWeight({ score: -0.9 }, 1), 0);
    assert.equal(signalToTargetWeight({ score: 0 }, 1), 1);
    assert.equal(signalToTargetWeight({ score: 0 }, 0), 0);
  });

  it("負 score 表 exit 不表 short：回傳值只可能是 0 或 1", () => {
    for (const score of [-1, -0.6, -0.5, 0, 0.5, 1]) {
      const w = signalToTargetWeight({ score }, 1);
      assert.ok(w === 0 || w === 1, `score=${score} → ${w}`);
    }
  });
});

describe("StrategyRegistry", () => {
  it("註冊／取得／列出；id 重複拒絕", () => {
    const reg = new StrategyRegistry();
    reg.register(VALID_DEF);
    assert.equal(reg.get("cash").name, "Cash");
    assert.equal(reg.list().length, 1);
    assert.throws(() => reg.register(VALID_DEF), /重複/);
    assert.throws(() => reg.get("nope"), /unknown strategy/);
  });
});

describe("StrategyLifecycle", () => {
  it("DRAFT 不得直跳 PAPER_ENABLED", () => {
    assert.throws(() => transitionLifecycle(LIFECYCLE.DRAFT, LIFECYCLE.PAPER_ENABLED), /illegal/);
  });

  it("合法路徑 DRAFT→BACKTESTED→RESEARCH_APPROVED→PAPER_ENABLED", () => {
    let s = LIFECYCLE.DRAFT;
    s = transitionLifecycle(s, LIFECYCLE.BACKTESTED);
    s = transitionLifecycle(s, LIFECYCLE.RESEARCH_APPROVED);
    s = transitionLifecycle(s, LIFECYCLE.PAPER_ENABLED);
    assert.equal(s, "PAPER_ENABLED");
  });

  it("KILL_SWITCHED 只能去 PAUSED 或 RETIRED", () => {
    assert.equal(transitionLifecycle(LIFECYCLE.KILL_SWITCHED, LIFECYCLE.PAUSED), "PAUSED");
    assert.throws(() => transitionLifecycle(LIFECYCLE.KILL_SWITCHED, LIFECYCLE.PAPER_ENABLED), /illegal/);
  });
});
