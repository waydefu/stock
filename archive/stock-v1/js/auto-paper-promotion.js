/* Shared promotion evaluation for Multi-Horizon Trend.
   Browser and server must use the same gate evidence; this module owns no DOM/network/storage. */
"use strict";

import { BUY_HOLD_STRATEGY, MULTI_HORIZON_TREND, makeTrendStrategy } from "./alpha.js";
import { fixedFraction, fullNotional } from "./portfolio.js";
import {
  evaluatePromotion,
  evaluateTrendSurface,
  evaluateWindow,
  parameterSurface,
  runCostStress,
  splitIS_OOS,
  summarizeResearch,
  walkForward,
} from "./research.js";

export const AUTO_PAPER_ALLOCATION = 0.10;
export const PROMOTION_MIN_BARS = 150;

function warmupTail(bars, warmup) {
  const n = Math.max(0, Math.floor(warmup) || 0);
  if (!n || !Array.isArray(bars)) return [];
  return bars.slice(-Math.min(n, bars.length));
}

export function evaluateAutoPaperPromotion({
  symbol,
  bars,
  allocation = AUTO_PAPER_ALLOCATION,
  commissionRate = 0.001425,
  slippageBps = 5,
  initialCapital = 1_000_000,
  feeModel = null,
  correctnessFindings = [],
} = {}) {
  if (typeof symbol !== "string" || !symbol) throw new Error("promotion 需要 symbol");
  if (!Array.isArray(bars) || bars.length < PROMOTION_MIN_BARS) {
    throw new Error(`INSUFFICIENT_RESEARCH_HISTORY：至少需要 ${PROMOTION_MIN_BARS} 根完成日 K`);
  }
  const fraction = Number(allocation);
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) throw new Error("allocation 必須在 (0,1]");

  const def = MULTI_HORIZON_TREND;
  const allocate = fixedFraction(fraction);
  const base = { symbol, strategy: def, allocate, commissionRate, slippageBps, initialCapital, feeModel };
  const split = splitIS_OOS(bars, 0.4);
  const isSummary = summarizeResearch(evaluateWindow({ ...base, contextBars: [], evalBars: split.is }), {});
  const oosSummary = summarizeResearch(evaluateWindow({
    ...base,
    contextBars: warmupTail(split.is, def.warmup),
    evalBars: split.oos,
  }), {});

  /* Do not discard an entire walk-forward window just because its train segment is
     shorter than warmup. evaluateWindow naturally stays flat until enough context
     exists. Dropping those windows made the >=3-window promotion gate structurally
     impossible with Fugle's <1-year history window. */
  const windows = walkForward(bars, { folds: 3, minWindow: 30 });
  const oosWindows = windows.map((window) => summarizeResearch(evaluateWindow({
    ...base,
    contextBars: warmupTail(window.train, def.warmup),
    evalBars: window.test,
  }), {}));

  const buyHoldOos = summarizeResearch(evaluateWindow({
    symbol,
    strategy: BUY_HOLD_STRATEGY,
    allocate: fullNotional(),
    contextBars: [],
    evalBars: split.oos,
    commissionRate,
    slippageBps,
    initialCapital,
    feeModel,
  }), {});

  const costStress = runCostStress({ ...base, bars }, (result) => summarizeResearch(result, {}), [1, 2]);
  const surfaceCells = evaluateTrendSurface({
    symbol,
    bars,
    shorts: [10, 20, 30],
    evalLength: 60,
    makeVariant: (short) => makeTrendStrategy({ id: `trend-s${short}`, short }),
    allocate,
    commissionRate,
    slippageBps,
    initialCapital,
    feeModel,
  });
  const surface = parameterSurface(surfaceCells);
  const surfaceFlag = surface.overfitRisk ? "OVERFIT_RISK" : "STABLE";
  const gate = evaluatePromotion({
    strategyId: def.id,
    isSummary,
    oosSummaries: oosWindows,
    costStress,
    surfaceFlag,
    correctnessFindings,
  });
  const lastSignal = def.generateSignal({ bars, index: bars.length - 1, symbol });

  return Object.freeze({
    strategy: def,
    allocation: fraction,
    split,
    isSummary,
    oosSummary,
    oosWindows,
    buyHoldOos,
    costStress,
    surface,
    gate,
    lastSignal,
    evidence: Object.freeze({
      bars: bars.length,
      allocation: fraction,
      oosNetProfit: oosSummary.netProfit,
      oosTradeCount: oosSummary.tradeCount,
      walkForwardNetProfit: Object.freeze(oosWindows.map((summary) => summary.netProfit)),
      costFragile: costStress.fragile,
      surfaceFlag,
      checks: Object.freeze(gate.checks.map((check) => Object.freeze({ ...check }))),
    }),
  });
}

export { warmupTail };
