/* 回測核心：bar-close 訊號、下一根開盤成交。
   這個模型刻意不偷看目前 bar 之前不存在的價格；結果僅代表模擬，不是實盤保證。 */
"use strict";

import { rollingHigh, rsi, sma } from "./data.js";

export const STRATEGIES = {
  maCross: "均線交叉",
  rsiReversal: "RSI 反轉",
  breakout: "通道突破",
};

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function validateBars(bars) {
  let previousTime = null;
  for (const [index, bar] of bars.entries()) {
    const validNumbers = [bar?.t, bar?.o, bar?.h, bar?.l, bar?.c, bar?.v].every(Number.isFinite);
    if (!validNumbers || bar.h < Math.max(bar.o, bar.c) || bar.l > Math.min(bar.o, bar.c) || bar.l > bar.h || bar.v < 0) {
      throw new Error(`invalid bar at index ${index}`);
    }
    if (previousTime !== null && bar.t <= previousTime) throw new Error(`invalid bar timestamp at index ${index}`);
    previousTime = bar.t;
  }
}

function signalFor(strategy, bars, i, options) {
  if (typeof strategy === "function") return strategy({ bars, i, closes: bars.map((b) => b.c), position: options.position });
  const closes = bars.map((b) => b.c);
  if (strategy === "rsiReversal") {
    const length = options.rsiLength ?? 14;
    const values = rsi(closes, length);
    const current = values[i];
    const previous = values[i - 1];
    if (current === null || previous === null) return "hold";
    if (previous <= (options.rsiBuy ?? 30) && current > (options.rsiBuy ?? 30)) return "buy";
    if (previous >= (options.rsiSell ?? 70) && current < (options.rsiSell ?? 70)) return "sell";
    return "hold";
  }
  if (strategy === "breakout") {
    const length = options.breakoutLength ?? 20;
    const highs = rollingHigh(closes, length);
    const lows = rollingHigh(closes.map((v) => -v), length)?.map((v) => v === null ? null : -v);
    if (highs[i] === null || lows[i] === null) return "hold";
    if (closes[i] > highs[i]) return "buy";
    if (closes[i] < lows[i]) return "sell";
    return "hold";
  }
  // Default: fast/slow SMA cross. 未有兩根完整均線時不交易。
  const fast = sma(closes, options.fast ?? 20);
  const slow = sma(closes, options.slow ?? 50);
  if (i < 1 || fast[i] === null || slow[i] === null || fast[i - 1] === null || slow[i - 1] === null) return "hold";
  if (fast[i - 1] <= slow[i - 1] && fast[i] > slow[i]) return "buy";
  if (fast[i - 1] >= slow[i - 1] && fast[i] < slow[i]) return "sell";
  return "hold";
}

/**
 * @param {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} bars
 * @param {string|Function} strategy
 * @param {object} options
 * @returns {{trades:Array, equity:number[], metrics:object, assumptions:object}}
 */
export function runBacktest(bars, strategy = "maCross", options = {}) {
  if (!Array.isArray(bars) || bars.length < 2) throw new Error("回測至少需要兩根 K 線");
  validateBars(bars);
  const initialCapital = finite(options.initialCapital, 1_000_000);
  if (initialCapital <= 0) throw new Error("初始資金必須大於 0");
  const periodsPerYear = finite(options.periodsPerYear, 252);
  if (periodsPerYear <= 0) throw new Error("Sharpe annualization periods must be greater than 0");
  const commissionRate = Math.max(0, finite(options.commissionRate, 0.001425));
  const slippageBps = Math.max(0, finite(options.slippageBps, 5));
  const positionPct = Math.min(1, Math.max(0.01, finite(options.positionPct, 0.25)));
  const slip = slippageBps / 10_000;
  let cash = initialCapital;
  let qty = 0;
  let entryPrice = 0;
  let entryTime = null;
  let entryFees = 0;
  let entrySignalIndex = null;
  let pending = null;
  const trades = [];
  const equity = [];
  const closes = bars.map((b) => b.c);

  const buyAt = (bar, signalIndex) => {
    if (qty > 0) return;
    const price = bar.o * (1 + slip);
    const budget = cash * positionPct;
    const candidate = Math.floor(budget / (price * (1 + commissionRate)));
    if (candidate <= 0) return;
    const cost = price * candidate;
    const fees = cost * commissionRate;
    cash -= cost + fees;
    qty = candidate;
    entryPrice = price;
    entryTime = bar.t;
    entryFees = fees;
    entrySignalIndex = signalIndex;
  };

  const sellAt = (bar, signalIndex, reason = "signal") => {
    if (qty <= 0) return;
    const price = bar.o * (1 - slip);
    const proceeds = price * qty;
    const fees = proceeds * commissionRate;
    cash += proceeds - fees;
    const grossPnl = (price - entryPrice) * qty;
    const totalFees = entryFees + fees;
    trades.push({
      entryTime,
      exitTime: bar.t,
      entryPrice,
      exitPrice: price,
      qty,
      grossPnl,
      fees: totalFees,
      netPnl: grossPnl - totalFees,
      entrySignalIndex,
      exitSignalIndex: signalIndex,
      exitReason: reason,
    });
    qty = 0;
    entryPrice = 0;
    entryTime = null;
    entryFees = 0;
    entrySignalIndex = null;
  };

  for (let i = 0; i < bars.length; i++) {
    // 先執行上一根收盤產生的訊號，成交價只能是本根開盤。
    if (pending === "buy") buyAt(bars[i], i - 1);
    if (pending === "sell") sellAt(bars[i], i - 1);
    pending = null;

    equity.push(cash + qty * bars[i].c);
    if (i < bars.length - 1) {
      const signal = signalFor(strategy, bars, i, { ...options, position: qty > 0 ? "long" : "flat" });
      if (signal === "buy" || signal === "sell") pending = signal;
    }
  }
  // 結束時用最後收盤平倉，並明確標示不是可實際成交的開盤價。
  if (qty > 0) {
    const bar = bars.at(-1);
    const price = bar.c * (1 - slip);
    const proceeds = price * qty;
    const fees = proceeds * commissionRate;
    cash += proceeds - fees;
    const grossPnl = (price - entryPrice) * qty;
    const totalFees = entryFees + fees;
    trades.push({
      entryTime,
      exitTime: bar.t,
      entryPrice,
      exitPrice: price,
      qty,
      grossPnl,
      fees: totalFees,
      netPnl: grossPnl - totalFees,
      entrySignalIndex,
      exitSignalIndex: bars.length - 1,
      exitReason: "end",
    });
    equity[equity.length - 1] = cash;
  }

  const finalCapital = equity.at(-1) ?? initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    const drawdown = peak - value;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    maxDrawdownPct = Math.max(maxDrawdownPct, peak > 0 ? (drawdown / peak) * 100 : 0);
  }
  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl < 0);
  const grossWins = wins.reduce((sum, t) => sum + t.netPnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, t) => sum + t.netPnl, 0));
  const returns = equity.slice(1).map((v, i) => equity[i] === 0 ? 0 : (v - equity[i]) / equity[i]);
  const avg = returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length ? returns.reduce((a, b) => a + (b - avg) ** 2, 0) / returns.length : 0;
  const std = Math.sqrt(variance);
  const metrics = {
    initialCapital,
    finalCapital,
    netProfit: finalCapital - initialCapital,
    netProfitPct: ((finalCapital / initialCapital) - 1) * 100,
    maxDrawdown,
    maxDrawdownPct,
    tradeCount: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLosses === 0 ? (grossWins > 0 ? Infinity : 0) : grossWins / grossLosses,
    sharpe: std === 0 ? 0 : (avg / std) * Math.sqrt(periodsPerYear),
  };
  return {
    trades,
    equity,
    metrics,
    assumptions: { strategy, commissionRate, slippageBps, positionPct, periodsPerYear, fill: "next_bar_open", forceClose: "last_close" },
    closes,
  };
}

export function formatMetric(value, digits = 2) {
  if (value === Infinity) return "∞";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}
