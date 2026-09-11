/* 研究引擎（Slice E）：分層回測＋IS/OOS＋walk-forward＋cost stress＋promotion gate。
   分層（與 legacy runBacktest 的融合迴圈對照，見 Slice A/B 審計）：
     Alpha（js/alpha.js）→ Signal → Portfolio（js/portfolio.js）→ target exposure
       → Execution（本檔：next-bar-open 立即紙上成交，IMMEDIATE 語義不變）
   策略只輸出 Signal，永遠不直接決定股數；股數只由 target exposure×資金算出。
   防未來函數：每根 bar 只把 0..i 的歷史切片交給策略（正確性優先於效能；
   研究資料量為數百根日 K，此處不做 precompute 優化）。 */
"use strict";

import { normalizeSignal, signalToTargetWeight, validateStrategy } from "./strategy.js";

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function assertResearchBars(bars) {
  if (!Array.isArray(bars) || bars.length < 2) throw new Error("研究回測至少需要兩根 K 線");
  let previousTime = null;
  for (const [index, bar] of bars.entries()) {
    const valid = [bar?.t, bar?.o, bar?.h, bar?.l, bar?.c, bar?.v].every(Number.isFinite);
    if (!valid || bar.h < Math.max(bar.o, bar.c) || bar.l > Math.min(bar.o, bar.c) || bar.v < 0) {
      throw new Error(`invalid bar at index ${index}`);
    }
    if (previousTime !== null && bar.t <= previousTime) throw new Error(`invalid bar timestamp at index ${index}`);
    previousTime = bar.t;
  }
}

/**
 * 分層研究回測（單標的 long-only）。
 * @returns {trades, equity, exposure, turnoverNotional, totalFees, totalSlippage, assumptions}
 */
export function runResearchBacktest({
  symbol,
  bars,
  strategy,
  allocate,
  commissionRate = 0.001425,
  slippageBps = 5,
  initialCapital = 1_000_000,
  entryThreshold = 0.5,
  exitThreshold = -0.5,
}) {
  if (typeof symbol !== "string" || !symbol) throw new Error("需要 symbol");
  validateStrategy(strategy);
  assertResearchBars(bars);
  if (typeof allocate !== "function") throw new Error("需要 Portfolio allocator（策略不得自己決定股數）");
  if (!(initialCapital > 0)) throw new Error("初始資金必須大於 0");
  return evaluateWindow({ symbol, strategy, allocate, contextBars: [], evalBars: bars, commissionRate, slippageBps, initialCapital, entryThreshold, exitThreshold });
}

/**
 * 正式 evaluation contract：[warmup context][evaluation window]。
 * context 只供指標歷史（OOS 第一根即可產生 signal，不再永遠 WARMUP），
 * 永不計入 PnL／trades／metrics；評估永遠 starting flat；index 皆為絕對位置。
 */
export function evaluateWindow({
  symbol,
  strategy,
  allocate,
  contextBars = [],
  evalBars,
  commissionRate = 0.001425,
  slippageBps = 5,
  initialCapital = 1_000_000,
  entryThreshold = 0.5,
  exitThreshold = -0.5,
}) {
  if (typeof symbol !== "string" || !symbol) throw new Error("需要 symbol");
  validateStrategy(strategy);
  if (!Array.isArray(evalBars) || evalBars.length < 1) throw new Error("evaluation window 至少需要一根 K 線");
  assertResearchBars(evalBars);
  const evals = evalBars;
  const context = contextBars ?? [];
  if (!Array.isArray(context)) throw new Error("contextBars 必須是陣列");
  if (context.length) assertResearchBars(context);
  if (typeof allocate !== "function") throw new Error("需要 Portfolio allocator（策略不得自己決定股數）");
  if (!(initialCapital > 0)) throw new Error("初始資金必須大於 0");
  const comm = Math.max(0, finite(commissionRate, 0.001425));
  const slip = Math.max(0, finite(slippageBps, 5)) / 10_000;

  let cash = initialCapital;
  let shares = 0;
  let entryPrice = 0;
  let entryTime = null;
  let entryFees = 0;
  let entrySlip = 0;
  let entrySignalIndex = null;
  let target = 0;
  const trades = [];
  const equity = [];
  const exposure = [];
  let turnoverNotional = 0;
  let totalFees = 0;
  let totalSlippage = 0;

  const buyAt = (bar, signalIndex, signal) => {
    if (shares > 0) return;
    const weight = Math.min(1, Math.max(0, finite(allocate(signal), 0)));
    if (weight <= 0) return;
    const price = bar.o * (1 + slip);
    const count = Math.floor((cash * weight) / (price * (1 + comm)));
    if (count <= 0) return;
    const cost = price * count;
    const fees = cost * comm;
    const slipCost = count * bar.o * slip;
    cash -= cost + fees;
    shares = count;
    entryPrice = price;
    entryTime = bar.t;
    entryFees = fees;
    entrySlip = slipCost;
    entrySignalIndex = signalIndex;
    turnoverNotional += cost;
  };

  const sellAt = (bar, signalIndex, reason) => {
    if (shares <= 0) return;
    const price = bar.o * (1 - slip);
    const proceeds = price * shares;
    const fees = proceeds * comm;
    const slipCost = shares * bar.o * slip;
    cash += proceeds - fees;
    const grossPnl = (price - entryPrice) * shares;
    const feesTotal = entryFees + fees;
    const slipTotal = entrySlip + slipCost;
    trades.push({
      entryTime, exitTime: bar.t, entryPrice, exitPrice: price,
      qty: shares, grossPnl, fees: feesTotal, slippage: slipTotal,
      netPnl: grossPnl - feesTotal,
      entrySignalIndex, exitSignalIndex: signalIndex, exitReason: reason,
    });
    totalFees += feesTotal;
    totalSlippage += slipTotal;
    turnoverNotional += proceeds;
    shares = 0;
    entryPrice = 0;
    entryTime = null;
    entryFees = 0;
    entrySlip = 0;
    entrySignalIndex = null;
  };

  const warmup = strategy.warmup;
  const base = context.length;
  for (let j = 0; j < evals.length; j++) {
    const absolute = base + j;
    if (absolute >= warmup && j < evals.length - 1) {
      const history = context.concat(evals.slice(0, j + 1));
      const raw = strategy.generateSignal({ bars: history, index: absolute, symbol });
      const signal = normalizeSignal(raw, { symbol, timestamp: evals[j].t });
      const next = signalToTargetWeight(signal, target, { entryThreshold, exitThreshold });
      if (next === 1 && target === 0) buyAt(evals[j + 1], absolute, signal);
      if (next === 0 && target === 1) sellAt(evals[j + 1], absolute, "signal");
      target = next;
    }
    const positionValue = shares * evals[j].c;
    const total = cash + positionValue;
    equity.push(total);
    exposure.push(total > 0 ? positionValue / total : 0);
  }
  if (shares > 0) {
    const bar = evals.at(-1);
    const price = bar.c * (1 - slip);
    const proceeds = price * shares;
    const fees = proceeds * comm;
    const slipCost = shares * bar.c * slip;
    cash += proceeds - fees;
    const grossPnl = (price - entryPrice) * shares;
    trades.push({
      entryTime, exitTime: bar.t, entryPrice, exitPrice: price,
      qty: shares, grossPnl, fees: entryFees + fees, slippage: entrySlip + slipCost,
      netPnl: grossPnl - entryFees - fees,
      entrySignalIndex, exitSignalIndex: base + evals.length - 1, exitReason: "end",
    });
    totalFees += entryFees + fees;
    totalSlippage += entrySlip + slipCost;
    turnoverNotional += proceeds;
    equity[equity.length - 1] = cash;
    exposure[exposure.length - 1] = 0;
  }
  return {
    trades, equity, exposure, turnoverNotional, totalFees, totalSlippage,
    assumptions: {
      strategyId: strategy.id, strategyVersion: strategy.version, warmup,
      warmupContextBars: base, evaluationBars: evals.length,
      fill: "next_bar_open", forceClose: "last_close",
      commissionRate: comm, slippageBps: slip * 10_000,
      entryThreshold, exitThreshold,
    },
  };
}

/** 參數平面共用 helper：UI／smoke／tests 同一語義。
 * 每個 variant 拿「評估窗之前」的完整 warmup context（variant.warmup，
 * 非 short 本身），評估窗為末段 evalLength 根；回傳 [{ params, value, trades }]。
 * 任一格不得因 context 不足退化成全零 WARMUP——由測試鎖死，不在這裡靜默。 */
export function evaluateTrendSurface({ symbol, bars, shorts = [10, 20, 30], evalLength = 60, makeVariant, allocate, commissionRate = 0.001425, slippageBps = 5, initialCapital = 1_000_000 } = {}) {
  if (!Array.isArray(bars) || bars.length <= evalLength) {
    throw new Error("surface 需要多於評估窗的歷史 K 線");
  }
  if (typeof makeVariant !== "function") throw new Error("surface 需要 makeVariant(short) 工廠");
  const tail = bars.slice(-evalLength);
  const beforeTail = bars.slice(0, -evalLength);
  return shorts.map((short) => {
    const variant = makeVariant(short);
    const warmup = Number.isFinite(variant?.warmup) ? variant.warmup : 0;
    const contextBars = warmup > 0 ? beforeTail.slice(-Math.min(warmup, beforeTail.length)) : [];
    const result = evaluateWindow({ symbol, strategy: variant, allocate, contextBars, evalBars: tail, commissionRate, slippageBps, initialCapital });
    return { params: { short }, value: summarizeResearch(result, {}).netProfit, trades: result.trades.length };
  });
}

/** 專業回測摘要：樣本不足的欄位回 null（UI 顯示 N/A），不硬算。 */
export function summarizeResearch(result, { periodsPerYear = 252, riskFreeRate = 0, minSamples = 3 } = {}) {
  const { equity, trades } = result;
  const n = equity.length;
  const initial = equity[0] ?? 0;
  const final = equity.at(-1) ?? initial;
  const out = {
    bars: n,
    initialCapital: initial,
    finalCapital: final,
    netProfit: final - initial,
    totalReturnPct: initial > 0 ? ((final / initial) - 1) * 100 : null,
    cagrPct: null, sharpe: null, sharpeInsufficient: true,
    sortino: null, volatilityPct: null,
    maxDrawdown: 0, maxDrawdownPct: 0, mddDurationBars: null,
    tradeCount: trades.length, winRate: null, profitFactor: null, expectancy: null,
    turnover: result.turnoverNotional / (initial > 0 ? initial : 1),
    avgExposure: 0, avgHoldingBars: null,
    totalFees: result.totalFees, totalSlippage: result.totalSlippage,
    bestTrade: null, worstTrade: null,
  };
  if (n >= 2 && initial > 0 && periodsPerYear > 0) {
    out.cagrPct = (Math.pow(final / initial, periodsPerYear / (n - 1)) - 1) * 100;
  }
  const returns = equity.slice(1).map((v, i) => (equity[i] === 0 ? 0 : (v - equity[i]) / equity[i]));
  if (returns.length >= minSamples) {
    out.sharpeInsufficient = false;
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + (b - avg) ** 2, 0) / returns.length;
    const std = Math.sqrt(variance);
    const excess = returns.map((r) => r - riskFreeRate);
    const downside = excess.filter((r) => r < 0);
    const downsideDev = downside.length ? Math.sqrt(downside.reduce((a, r) => a + r * r, 0) / downside.length) : 0;
    out.volatilityPct = std * Math.sqrt(periodsPerYear) * 100;
    if (std > 0) out.sharpe = ((avg - riskFreeRate) / std) * Math.sqrt(periodsPerYear);
    if (downsideDev > 0) {
      const avgExcess = excess.reduce((a, b) => a + b, 0) / excess.length;
      out.sortino = (avgExcess / downsideDev) * Math.sqrt(periodsPerYear);
    }
  }
  let peak = initial;
  let peakIdx = 0;
  let maxDuration = 0;
  let inDrawdown = false;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] >= peak) {
      if (inDrawdown) {
        maxDuration = Math.max(maxDuration, i - peakIdx);
        inDrawdown = false;
      }
      peak = equity[i];
      peakIdx = i;
    } else {
      inDrawdown = true;
      const dd = peak - equity[i];
      out.maxDrawdown = Math.max(out.maxDrawdown, dd);
      if (peak > 0) out.maxDrawdownPct = Math.max(out.maxDrawdownPct, (dd / peak) * 100);
    }
  }
  if (inDrawdown) maxDuration = Math.max(maxDuration, equity.length - 1 - peakIdx);
  out.mddDurationBars = out.maxDrawdown > 0 ? maxDuration : 0;
  if (out.maxDrawdown > 0 && out.maxDrawdownPct > 0 && n > 1) {
    out.calmar = (out.cagrPct ?? 0) / out.maxDrawdownPct;
  } else {
    out.calmar = null;
  }
  if (trades.length > 0) {
    const wins = trades.filter((t) => t.netPnl > 0);
    const grossWins = wins.reduce((a, t) => a + t.netPnl, 0);
    const grossLosses = Math.abs(trades.filter((t) => t.netPnl < 0).reduce((a, t) => a + t.netPnl, 0));
    out.winRate = (wins.length / trades.length) * 100;
    out.profitFactor = grossLosses === 0 ? (grossWins > 0 ? Infinity : 0) : grossWins / grossLosses;
    out.expectancy = trades.reduce((a, t) => a + t.netPnl, 0) / trades.length;
    out.avgHoldingBars = trades.reduce((a, t) => a + (t.exitSignalIndex - t.entrySignalIndex), 0) / trades.length;
    out.bestTrade = Math.max(...trades.map((t) => t.netPnl));
    out.worstTrade = Math.min(...trades.map((t) => t.netPnl));
  }
  out.avgExposure = result.exposure.length ? result.exposure.reduce((a, b) => a + b, 0) / result.exposure.length : 0;
  return out;
}

/** 時序切分 IS／OOS：OOS 永遠是後段，UI 不得混成一條曲線。 */
export function splitIS_OOS(bars, oosRatio = 0.4) {
  if (!Array.isArray(bars) || bars.length < 4) throw new Error("IS/OOS 切分至少需要 4 根 K 線");
  if (!(oosRatio > 0) || oosRatio >= 1) throw new Error("oosRatio 必須在 (0, 1) 區間");
  const oosLen = Math.floor(bars.length * oosRatio);
  if (oosLen < 2 || bars.length - oosLen < 2) throw new Error("切分後 IS 或 OOS 不足 2 根");
  return { is: bars.slice(0, bars.length - oosLen), oos: bars.slice(bars.length - oosLen) };
}

/** Walk-forward：train 遞增、test 滾動、test 區間互不重疊且都在 train 之後。 */
export function walkForward(bars, { folds = 3, minWindow = 30 } = {}) {
  if (!Number.isInteger(folds) || folds < 1) throw new Error("folds 必須是正整數");
  const seg = Math.floor(bars.length / (folds + 1));
  if (seg < minWindow) throw new Error(`資料不足以切 ${folds} 個 walk-forward 窗口（每段至少 ${minWindow} 根）`);
  const windows = [];
  for (let k = 0; k < folds; k++) {
    windows.push({
      train: bars.slice(0, seg * (k + 1)),
      test: bars.slice(seg * (k + 1), seg * (k + 2)),
    });
  }
  return windows;
}

/** 成本壓力矩陣：同策略跑 0.5×／1×／2×／3× 成本；2× 反轉獲利即 EXECUTION_FRAGILE。 */
export const COST_STRESS_MULTIPLIERS = [0.5, 1, 2, 3];

export function runCostStress(baseArgs, summarize, multipliers = COST_STRESS_MULTIPLIERS) {
  const runs = multipliers.map((mult) => {
    const result = runResearchBacktest({
      ...baseArgs,
      commissionRate: baseArgs.commissionRate * mult,
      slippageBps: baseArgs.slippageBps * mult,
    });
    return { mult, summary: summarize(result) };
  });
  const base = runs.find((r) => r.mult === 1);
  const stressed = runs.find((r) => r.mult === 2);
  const fragile = Boolean(base && stressed && base.summary.netProfit > 0 && stressed.summary.netProfit <= 0);
  return { runs, fragile, flag: fragile ? "EXECUTION_FRAGILE" : null };
}

/**
 * 參數平面穩健性：最佳格若是孤立尖峰（鄰格平均遠低）→ OVERFIT_RISK。
 * cells: [{ params: {k: number}, value: number }]；鄰格＝恰好一個參數不同的格。
 */
export function parameterSurface(cells) {
  if (!Array.isArray(cells) || cells.length === 0) throw new Error("parameter surface 至少需要一個 cell");
  let best = cells[0];
  for (const c of cells) if (c.value > best.value) best = c;
  const keys = Object.keys(best.params);
  const neighbors = cells.filter((c) => {
    if (c === best) return false;
    const diffs = keys.filter((k) => c.params[k] !== best.params[k]);
    return diffs.length === 1;
  });
  let overfitRisk = false;
  let detail = "無鄰格可比，不判定";
  if (neighbors.length > 0) {
    const mean = neighbors.reduce((a, c) => a + c.value, 0) / neighbors.length;
    overfitRisk = best.value > 0 && best.value > 2 * Math.max(mean, 0) && mean <= best.value / 2;
    detail = `best=${best.value.toFixed(4)} neighborMean=${mean.toFixed(4)} n=${neighbors.length}`;
  }
  return { cells, best, neighbors: neighbors.length, overfitRisk, flag: overfitRisk ? "OVERFIT_RISK" : null, detail };
}

/** Promotion gate（本 repo 保守工程門檻，非金融宇宙真理；不適用須說明，不得偷降）。 */
export function evaluatePromotion({ strategyId, isSummary, oosSummaries = [], costStress = null, surfaceFlag = null, correctnessFindings = [] }) {
  const checks = [];
  const oosCount = oosSummaries.length;
  checks.push({
    id: "oos-windows",
    pass: oosCount >= 3,
    detail: `OOS 窗口 ${oosCount}／要求 >= 3`,
  });
  const oosTotal = oosSummaries.reduce((a, s) => a + (s?.netProfit ?? 0), 0);
  checks.push({
    id: "oos-expectancy",
    pass: oosCount >= 3 && oosTotal > 0,
    detail: `OOS 合計損益 ${Math.round(oosTotal)}（須為正）`,
  });
  let concentrationPass = false;
  let concentrationDetail = "OOS 窗口不足，不判定";
  if (oosCount >= 3 && oosTotal > 0) {
    const maxShare = Math.max(...oosSummaries.map((s) => s.netProfit / oosTotal));
    concentrationPass = maxShare <= 0.6;
    concentrationDetail = `最大單窗口佔比 ${(maxShare * 100).toFixed(1)}%（須 <= 60%）`;
  }
  checks.push({ id: "oos-concentration", pass: concentrationPass, detail: concentrationDetail });
  checks.push({
    id: "cost-stress",
    pass: Boolean(costStress) && !costStress.fragile,
    detail: costStress ? (costStress.fragile ? "2× 成本反轉獲利：EXECUTION_FRAGILE" : "2× 成本未反轉獲利") : "缺 cost stress 證據",
  });
  checks.push({
    id: "param-plateau",
    pass: surfaceFlag === "STABLE",
    detail: surfaceFlag === "OVERFIT_RISK" ? "最佳參數是孤立尖峰" : surfaceFlag === "STABLE" ? "參數平面呈穩定高原" : "缺參數平面證據",
  });
  const p0p1 = correctnessFindings.filter((f) => f === "P0" || f === "P1");
  checks.push({
    id: "correctness",
    pass: p0p1.length === 0,
    detail: p0p1.length ? `仍有 P0/P1 correctness finding：${p0p1.join(",")}` : "無 P0/P1 finding",
  });
  return { strategyId, pass: checks.every((c) => c.pass), checks };
}
