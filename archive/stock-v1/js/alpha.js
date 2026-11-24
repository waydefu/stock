/* 研究基準策略庫（Slice D）：永遠保留的 baselines＋多 horizon 趨勢研究策略。
   不是「必然賺錢清單」；所有新策略都必須先跟 baselines 比，且只在
   IS／OOS＋cost stress 下比較（見 js/research.js）。

   多 horizon 趨勢的研究假說（hypothesis 見策略定義）：
   時間序列動量（Moskowitz, Ooi, Pedersen：過去報酬符號具延續性；
   Hurst, Ooi, Pedersen：跨世紀、多市場的趨勢跟隨證據）指出，單一
   MA 交叉參數脆弱；本策略用短／中／長三個 horizon 的正規化趨勢分數
   加權組合，追求「穩定高原」而非最佳單點。參數刻意少、可解釋。
   完整出處進 docs/RESEARCH_LEDGER.md；此處只記假說，不偽裝成定論。 */
"use strict";

import { StrategyRegistry } from "./strategy.js";

function smaTail(closes, length) {
  if (closes.length < length || length <= 0) return null;
  let sum = 0;
  for (let i = closes.length - length; i < closes.length; i++) sum += closes[i];
  return sum / length;
}

function stdevTail(closes, length) {
  if (closes.length < length + 1 || length < 2) return null;
  const rets = [];
  for (let i = closes.length - length; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (!(prev > 0)) return null;
    rets.push((closes[i] - prev) / prev);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

/** 單 horizon 正規化趨勢分數：(現價 - 均線)／(波動×現價)，夾取 ±1。 */
export function horizonScore(closes, length) {
  const basis = smaTail(closes, length);
  const vol = stdevTail(closes, length);
  const price = closes.at(-1);
  if (basis === null || vol === null || !(price > 0)) return null;
  if (vol === 0) return 0;
  const raw = (price - basis) / (vol * price);
  return Math.max(-1, Math.min(1, raw));
}

export const CASH_STRATEGY = {
  id: "cash",
  name: "Cash（現金基準）",
  version: "1.0.0",
  hypothesis: "持有現金，不承擔市場風險；所有策略絕對報酬比較的起點。",
  requiredData: ["ohlcv:daily"],
  warmup: 0,
  parameters: {},
  generateSignal: () => ({ score: 0, confidence: 1, horizon: "none", reasonCodes: ["CASH"], diagnostics: {} }),
};

export const BUY_HOLD_STRATEGY = {
  id: "buyHold",
  name: "Buy & Hold（買入持有基準）",
  version: "1.0.0",
  hypothesis: "第一根 bar 開盤買入並持有到結尾；任何主動策略必須先贏過它才值得談。",
  requiredData: ["ohlcv:daily"],
  warmup: 0,
  parameters: {},
  generateSignal: () => ({ score: 1, confidence: 1, horizon: "full-sample", reasonCodes: ["BUY_HOLD"], diagnostics: {} }),
};

export function makeTrendStrategy({ id = "multiHorizonTrend", short = 20, medium = 60, long = 120, weights = [1, 1, 1] } = {}) {
  const horizon = `multi:${short}/${medium}/${long}`;
  return {
    id,
    name: "Multi-Horizon Trend（多 horizon 趨勢研究）",
    version: "1.0.0",
    hypothesis:
      "時間序列動量具延續性，但單一均線交叉參數脆弱；短／中／長三個正規化趨勢分數加權" +
      "組合，在方向一致時提高信心、方向分歧時降權，追求參數高原而非最佳單點。",
    requiredData: ["ohlcv:daily"],
    warmup: long,
    parameters: { short, medium, long, weights },
    generateSignal({ bars, index, symbol }) {
      void symbol;
      const closes = bars.slice(0, index + 1).map((b) => b.c);
      const parts = [
        { key: "short", value: horizonScore(closes, short), weight: weights[0] },
        { key: "medium", value: horizonScore(closes, medium), weight: weights[1] },
        { key: "long", value: horizonScore(closes, long), weight: weights[2] },
      ];
      if (parts.some((p) => p.value === null)) {
        return { score: 0, confidence: 0, horizon, reasonCodes: ["WARMUP"], diagnostics: {} };
      }
      const totalWeight = parts.reduce((a, p) => a + p.weight, 0);
      const combined = parts.reduce((a, p) => a + p.value * p.weight, 0) / totalWeight;
      const signs = parts.map((p) => Math.sign(p.value));
      const agree = Math.max(
        signs.filter((s) => s > 0).length,
        signs.filter((s) => s < 0).length,
      );
      const confidence = agree / signs.length;
      const reason = combined > 0.05 ? "TREND_UP" : combined < -0.05 ? "TREND_DOWN" : "TREND_MIXED";
      return {
        score: combined,
        confidence,
        horizon,
        reasonCodes: [reason],
        diagnostics: Object.fromEntries(parts.map((p) => [p.key, Math.round(p.value * 1000) / 1000])),
      };
    },
  };
}

export const MULTI_HORIZON_TREND = makeTrendStrategy();

/** 預設研究註冊表：baselines 永遠在，新策略往後加。 */
export function buildDefaultRegistry() {
  const reg = new StrategyRegistry();
  reg.register(CASH_STRATEGY);
  reg.register(BUY_HOLD_STRATEGY);
  reg.register(MULTI_HORIZON_TREND);
  return reg;
}
