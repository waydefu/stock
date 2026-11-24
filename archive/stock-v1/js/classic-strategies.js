/* Classic deterministic strategy signals shared by the legacy backtest and the layered Strategy contract.
   This module owns signal semantics only. It never sizes positions, executes orders, mutates accounts, or touches DOM/network. */
"use strict";

import { rollingHigh, rsi, sma } from "./data.js";

export const CLASSIC_STRATEGY_NAMES = {
  maCross: "均線交叉",
  rsiReversal: "RSI 反轉",
  breakout: "通道突破",
};

const CLASSIC_IDS = new Set(Object.keys(CLASSIC_STRATEGY_NAMES));

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function canonicalId(id) {
  // Legacy runBacktest historically treated unknown string ids as maCross.
  return id === "rsiReversal" || id === "breakout" ? id : "maCross";
}

export function prepareClassicSignalData(strategyId, bars, options = {}) {
  const id = canonicalId(strategyId);
  const closes = bars.map((bar) => bar.c);
  if (id === "rsiReversal") {
    return { closes, rsiValues: rsi(closes, positiveInt(options.rsiLength, 14)) };
  }
  if (id === "breakout") {
    const length = positiveInt(options.breakoutLength, 20);
    const highs = rollingHigh(closes, length);
    const lows = rollingHigh(closes.map((value) => -value), length)
      .map((value) => value === null ? null : -value);
    return { closes, highs, lows };
  }
  return {
    closes,
    fast: sma(closes, positiveInt(options.fast, 20)),
    slow: sma(closes, positiveInt(options.slow, 50)),
  };
}

export function classicSignalFor(strategyId, bars, index, options = {}, prepared = null) {
  const id = canonicalId(strategyId);
  const data = prepared ?? prepareClassicSignalData(id, bars, options);

  if (id === "rsiReversal") {
    const buyLevel = Number.isFinite(options.rsiBuy) ? options.rsiBuy : 30;
    const sellLevel = Number.isFinite(options.rsiSell) ? options.rsiSell : 70;
    const current = data.rsiValues[index];
    const previous = data.rsiValues[index - 1];
    if (current === null || current === undefined || previous === null || previous === undefined) return "hold";
    if (previous <= buyLevel && current > buyLevel) return "buy";
    if (previous >= sellLevel && current < sellLevel) return "sell";
    return "hold";
  }

  if (id === "breakout") {
    if (data.highs[index] === null || data.highs[index] === undefined || data.lows[index] === null || data.lows[index] === undefined) return "hold";
    if (data.closes[index] > data.highs[index]) return "buy";
    if (data.closes[index] < data.lows[index]) return "sell";
    return "hold";
  }

  const { fast, slow } = data;
  if (index < 1 || fast[index] === null || slow[index] === null || fast[index - 1] === null || slow[index - 1] === null) return "hold";
  if (fast[index - 1] <= slow[index - 1] && fast[index] > slow[index]) return "buy";
  if (fast[index - 1] >= slow[index - 1] && fast[index] < slow[index]) return "sell";
  return "hold";
}

function warmupFor(id, options) {
  if (id === "rsiReversal") return positiveInt(options.rsiLength, 14) + 1;
  if (id === "breakout") return positiveInt(options.breakoutLength, 20);
  return positiveInt(options.slow, 50);
}

function hypothesisFor(id) {
  if (id === "rsiReversal") return "RSI 從超賣區向上穿越時進場，從超買區向下穿越時退出；只作為可解釋經典基準。";
  if (id === "breakout") return "收盤突破前 N 根高點時進場、跌破前 N 根低點時退出；Donchian 區間不含當根。";
  return "短期均線向上穿越長期均線時進場、向下穿越時退出；只作為可解釋經典基準。";
}

export function createClassicStrategy(strategyId, options = {}) {
  if (!CLASSIC_IDS.has(strategyId)) throw new Error(`unknown classic strategy: ${strategyId}`);
  const params = { ...options };
  return {
    id: strategyId,
    name: CLASSIC_STRATEGY_NAMES[strategyId],
    version: "1.0.0",
    hypothesis: hypothesisFor(strategyId),
    requiredData: ["ohlcv:daily"],
    warmup: warmupFor(strategyId, params),
    parameters: params,
    generateSignal({ bars, index }) {
      const action = classicSignalFor(strategyId, bars, index, params);
      return {
        score: action === "buy" ? 1 : action === "sell" ? -1 : 0,
        confidence: action === "hold" ? 0 : 1,
        horizon: "classic",
        reasonCodes: [`CLASSIC_${strategyId.toUpperCase()}_${action.toUpperCase()}`],
        diagnostics: { action },
      };
    },
  };
}
