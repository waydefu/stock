/* Classic backtest product composition.
   Keeps MA / RSI / Breakout on the same layered Strategy → Portfolio → Research execution path
   as newer research strategies. Legacy runBacktest remains compatibility/test-only. */
"use strict";

import { createClassicStrategy } from "./classic-strategies.js";
import { fixedFraction } from "./portfolio.js";
import { runResearchBacktest, summarizeResearch } from "./research.js";

export const CLASSIC_UI_POSITION_FRACTION = 0.25;

export function runClassicLayeredBacktest({
  symbol,
  bars,
  strategyId,
  strategyOptions = {},
  initialCapital = 1_000_000,
  commissionRate = 0.001425,
  slippageBps = 5,
  feeModel = null,
  positionFraction = CLASSIC_UI_POSITION_FRACTION,
} = {}) {
  if (typeof symbol !== "string" || !symbol) throw new Error("classic backtest 需要 symbol");
  const strategy = createClassicStrategy(strategyId, strategyOptions);
  const allocate = fixedFraction(positionFraction);
  const result = runResearchBacktest({
    symbol,
    bars,
    strategy,
    allocate,
    initialCapital,
    commissionRate,
    slippageBps,
    feeModel,
  });
  const summary = summarizeResearch(result, {
    periodsPerYear: 252,
    riskFreeRate: 0,
    minSamples: 3,
    feeModel,
  });
  return Object.freeze({
    strategy,
    positionFraction,
    result,
    summary,
  });
}
