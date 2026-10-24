/* Pure forward-test performance metrics.
   Uses durable journal evidence only. No network, storage, strategy decisions, or trading side effects. */
"use strict";

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function dailyEquitySeries(entries) {
  const bySession = new Map();
  for (const entry of entries ?? []) {
    const key = entry?.account?.sessionKey;
    const equity = finite(entry?.account?.equity);
    if (!key || !(equity > 0)) continue;
    // Journal order is monotonic; keep the last priced snapshot for each session.
    bySession.set(key, { sessionKey: key, equity, timestamp: entry.timestamp });
  }
  return [...bySession.values()];
}

export function summarizeDailyRisk(entries, { periodsPerYear = 252, minSamples = 3 } = {}) {
  const daily = dailyEquitySeries(entries);
  const returns = [];
  for (let i = 1; i < daily.length; i++) {
    const previous = daily[i - 1].equity;
    const current = daily[i].equity;
    if (previous > 0) returns.push((current - previous) / previous);
  }

  const result = {
    dailyEquitySamples: daily.length,
    dailyReturnSamples: returns.length,
    annualizationPeriods: periodsPerYear,
    minRiskSamples: minSamples,
    volatilityPct: null,
    sharpe: null,
    sortino: null,
  };
  if (returns.length < minSamples || !(periodsPerYear > 0)) return Object.freeze(result);

  const avg = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  const downside = returns.filter((value) => value < 0);
  const downsideDev = downside.length
    ? Math.sqrt(downside.reduce((sum, value) => sum + value ** 2, 0) / downside.length)
    : 0;

  result.volatilityPct = std * Math.sqrt(periodsPerYear) * 100;
  if (std > 0) result.sharpe = (avg / std) * Math.sqrt(periodsPerYear);
  if (downsideDev > 0) result.sortino = (avg / downsideDev) * Math.sqrt(periodsPerYear);
  return Object.freeze(result);
}

function flattenFills(entries) {
  const seen = new Set();
  const fills = [];
  for (const entry of entries ?? []) {
    const timestamp = Date.parse(entry?.timestamp);
    if (!Number.isFinite(timestamp)) continue;
    for (const fill of entry?.fills ?? []) {
      if (!fill?.orderId || seen.has(fill.orderId)) continue;
      seen.add(fill.orderId);
      fills.push({ ...fill, timestamp });
    }
  }
  return fills;
}

/* Long-only round-trip accounting mirrors PaperBroker's average-cost semantics:
   buy fee is capitalized into average cost; sell fee is realized on exit. */
export function summarizeClosedTrades(entries) {
  const fills = flattenFills(entries);
  let qty = 0;
  let avgCost = 0;
  let openedAt = null;
  let tradePnl = 0;
  let anomalies = 0;
  const trades = [];

  for (const fill of fills) {
    const fillQty = Number(fill.qty);
    const price = Number(fill.price);
    const fee = Number(fill.fee ?? 0);
    if (!Number.isInteger(fillQty) || fillQty <= 0 || !(price > 0) || !(fee >= 0)) {
      anomalies += 1;
      continue;
    }

    if (fill.side === "buy") {
      if (qty === 0) {
        openedAt = fill.timestamp;
        tradePnl = 0;
      }
      const nextQty = qty + fillQty;
      avgCost = ((avgCost * qty) + (price * fillQty) + fee) / nextQty;
      qty = nextQty;
      continue;
    }

    if (fill.side !== "sell" || fillQty > qty || qty <= 0) {
      anomalies += 1;
      continue;
    }
    tradePnl += (price - avgCost) * fillQty - fee;
    qty -= fillQty;
    if (qty === 0) {
      trades.push({
        netPnl: tradePnl,
        openedAt,
        closedAt: fill.timestamp,
        holdingMs: openedAt === null ? null : Math.max(0, fill.timestamp - openedAt),
      });
      avgCost = 0;
      openedAt = null;
      tradePnl = 0;
    }
  }

  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const netClosedPnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const holding = trades.map((trade) => trade.holdingMs).filter(Number.isFinite);

  return Object.freeze({
    closedTradeCount: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : null,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    profitFactorReason: trades.length && grossLoss === 0 ? "NO_LOSING_TRADES" : null,
    expectancy: trades.length ? netClosedPnl / trades.length : null,
    netClosedPnl,
    avgHoldingHours: holding.length ? (holding.reduce((sum, value) => sum + value, 0) / holding.length) / 3_600_000 : null,
    openPositionQty: qty,
    fillSequenceAnomalies: anomalies,
  });
}

export function summarizeBuyHold(entries, strategyReturnPct = null) {
  const priced = (entries ?? []).filter((entry) => Number.isFinite(entry?.marketPrice) && entry.marketPrice > 0);
  const first = priced[0] ?? null;
  const last = priced.at(-1) ?? null;
  const buyHoldReturnPct = first && last
    ? ((last.marketPrice - first.marketPrice) / first.marketPrice) * 100
    : null;
  return Object.freeze({
    benchmarkStartPrice: first?.marketPrice ?? null,
    benchmarkEndPrice: last?.marketPrice ?? null,
    buyHoldReturnPct,
    excessVsBuyHoldPct: Number.isFinite(strategyReturnPct) && Number.isFinite(buyHoldReturnPct)
      ? strategyReturnPct - buyHoldReturnPct
      : null,
  });
}

export function summarizeForwardPerformance(entries, { strategyReturnPct = null } = {}) {
  return Object.freeze({
    ...summarizeDailyRisk(entries),
    ...summarizeClosedTrades(entries),
    ...summarizeBuyHold(entries, strategyReturnPct),
  });
}
