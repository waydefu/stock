/* Real-research date range: always strictly inside one calendar year.
   Fugle historical rejects exactly-one-year spans (e.g. 2025-01-01~2026-01-01),
   so a fixed 350-day lookback is used: any 350-day span is provably < 1 year
   (max span 350d can never reach the same month/day next year).
   Shared by the Pages runner and the smoke scripts — one helper, no drift. */
"use strict";

import { isLessThanOneCalendarYear } from "./market-data-contract.js";

export const RESEARCH_LOOKBACK_DAYS = 350;

export function fugleResearchRange({ to, lookbackDays = RESEARCH_LOOKBACK_DAYS } = {}) {
  if (typeof to !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error(`research range 需要 yyyy-MM-dd 的 to：${to}`);
  }
  const days = Math.max(1, Math.floor(lookbackDays));
  const [y, m, d] = to.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d) - days * 86_400_000).toISOString().slice(0, 10);
  if (from >= to || !isLessThanOneCalendarYear(from, to)) {
    throw new Error(`research range 非法：${from} ~ ${to}`);
  }
  return { from, to };
}
