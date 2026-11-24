/* Portfolio 層（Slice E）：只回答「分配多少資金／風險」，不產生訊號、不下單。
   - Allocator：Signal → target exposure weight（0..1，long-only）。
   - VolatilityTargetingOverlay：波動越高降曝險；leverage 永遠有硬上限，
     不允許「低波動→無限槓桿」（概念見 Moreira & Muir, Volatility-Managed
     Portfolios：原文亦測試 leverage cap 1／1.5 的受限版本）。
   - checkPortfolioLimits：組合硬上限，違規回 reason codes（供 audit log）。 */
"use strict";

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/** 固定比例曝險（例如 0.25＝單標的最多用 25% 淨值）。 */
export function fixedFraction(fraction) {
  const f = finite(fraction, 0.25);
  if (!(f > 0) || f > 1) throw new Error("fraction 必須在 (0, 1] 區間");
  return () => f;
}

/** 全額曝險（只適合 buy&hold 基準這類單一持有研究）。 */
export function fullNotional() {
  return () => 1;
}

/**
 * 波動目標覆蓋：scale = targetVol／realizedVol，再夾在 [minExposure, maxLeverage]。
 * maxLeverage 必須有限 → 低波動不會變無限槓桿。
 */
export function volatilityTargetScale(realizedVol, { targetVol = 0.15, maxLeverage = 1, minExposure = 0 } = {}) {
  if (!Number.isFinite(targetVol) || targetVol <= 0) throw new Error("targetVol 必須是正數");
  if (!Number.isFinite(maxLeverage) || maxLeverage <= 0) throw new Error("maxLeverage 必須是有限正數");
  if (!Number.isFinite(minExposure) || minExposure < 0) throw new Error("minExposure 必須是非負數");
  if (minExposure > maxLeverage) throw new Error("minExposure 不可大於 maxLeverage");
  const vol = Number.isFinite(realizedVol) && realizedVol > 0 ? realizedVol : targetVol;
  const raw = targetVol / vol;
  return Math.min(maxLeverage, Math.max(minExposure, raw));
}

/**
 * 組合硬上限檢查（全部 configurable＋reason coded）：
 * limits: { maxSingleExposure, maxGrossExposure, maxHoldings, maxDailyLossPct, maxConcentration }
 * positions: [{ symbol, marketValue }], equity > 0, dailyPnlPct 可為 null（無資料不判）。
 */
export function checkPortfolioLimits({ positions = [], equity = 0, dailyPnlPct = null } = {}, limits = {}) {
  const violations = [];
  if (!(equity > 0)) {
    violations.push("INVALID_EQUITY");
    return { ok: false, violations };
  }
  const gross = positions.reduce((a, p) => a + Math.abs(p.marketValue || 0), 0);
  const grossExposure = gross / equity;
  if (limits.maxGrossExposure !== undefined && grossExposure > limits.maxGrossExposure) violations.push("GROSS_EXPOSURE");
  if (limits.maxHoldings !== undefined && positions.length > limits.maxHoldings) violations.push("MAX_HOLDINGS");
  if (limits.maxDailyLossPct !== undefined && dailyPnlPct !== null && dailyPnlPct <= -Math.abs(limits.maxDailyLossPct)) {
    violations.push("MAX_DAILY_LOSS");
  }
  const bySymbol = new Map();
  for (const p of positions) bySymbol.set(p.symbol, (bySymbol.get(p.symbol) || 0) + Math.abs(p.marketValue || 0));
  for (const [symbol, value] of bySymbol) {
    if (limits.maxSingleExposure !== undefined && value / equity > limits.maxSingleExposure) {
      violations.push(`SINGLE_EXPOSURE:${symbol}`);
    }
  }
  if (limits.maxConcentration !== undefined) {
    const top = Math.max(0, ...[...bySymbol.values()]);
    if (gross > 0 && top / gross > limits.maxConcentration) violations.push("CONCENTRATION");
  }
  return { ok: violations.length === 0, violations };
}
