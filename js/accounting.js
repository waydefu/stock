"use strict";

export const ACCOUNTING_VERSION = 1;

export const ZERO_FEE_MODEL = Object.freeze({
  name: "zero-fee-paper",
  calculate: () => 0,
});

export function feeFor(feeModel, context) {
  if (!feeModel || typeof feeModel.calculate !== "function") throw new Error("FeeModel 必須提供 calculate(context)");
  const fee = Number(feeModel.calculate(context));
  if (!Number.isFinite(fee) || fee < 0) throw new Error("FeeModel 回傳無效費用");
  return fee;
}

export function createAccountSnapshot({
  market,
  currency,
  initialCash,
  cash,
  positions = {},
  orders = [],
  realizedPnl = 0,
  totalFees = 0,
  feeModel = ZERO_FEE_MODEL.name,
  sessionKey = null,
  sessionOpenEquity = initialCash,
}) {
  const normalizedPositions = {};
  let marketValue = 0;
  let unrealizedPnl = 0;
  for (const [symbol, source] of Object.entries(positions)) {
    const qty = Number(source.qty);
    const avgCost = Number(source.avgCost);
    const last = Number(source.last ?? avgCost);
    if (!Number.isInteger(qty) || qty <= 0 || !Number.isFinite(avgCost) || avgCost <= 0 || !Number.isFinite(last) || last <= 0) {
      throw new Error(`帳戶持倉 invariant 失敗：${symbol}`);
    }
    const value = last * qty;
    const unrealized = (last - avgCost) * qty;
    normalizedPositions[symbol] = { ...source, symbol: source.symbol ?? symbol, qty, avgCost, last, marketValue: value, unrealized };
    marketValue += value;
    unrealizedPnl += unrealized;
  }

  const normalizedCash = Number(cash);
  const normalizedInitialCash = Number(initialCash);
  const normalizedRealized = Number(realizedPnl);
  const normalizedFees = Number(totalFees);
  const normalizedSessionOpen = Number(sessionOpenEquity);
  if (![normalizedCash, normalizedInitialCash, normalizedRealized, normalizedFees, normalizedSessionOpen].every(Number.isFinite)) throw new Error("AccountSnapshot 包含非有限數值");
  if (normalizedCash < 0 || normalizedInitialCash <= 0 || normalizedFees < 0 || normalizedSessionOpen <= 0) throw new Error("AccountSnapshot cash／reference invariant 失敗");

  const equity = normalizedCash + marketValue;
  const totalPnl = normalizedRealized + unrealizedPnl;
  const dailyPnl = equity - normalizedSessionOpen;
  const snapshot = {
    accountingVersion: ACCOUNTING_VERSION,
    market,
    currency,
    initialCash: normalizedInitialCash,
    cash: normalizedCash,
    marketValue,
    equity,
    realizedPnl: normalizedRealized,
    unrealizedPnl,
    totalPnl,
    totalFees: normalizedFees,
    feeModel,
    sessionKey,
    sessionOpenEquity: normalizedSessionOpen,
    dailyPnl,
    dailyPnlPct: (dailyPnl / normalizedSessionOpen) * 100,
    dailyLossReferenceEquity: normalizedSessionOpen,
    positions: normalizedPositions,
    orders,
  };
  assertAccountingInvariants(snapshot);
  return snapshot;
}

export function assertAccountingInvariants(snapshot) {
  if (snapshot.equity !== snapshot.cash + snapshot.marketValue) throw new Error("Accounting invariant 失敗：equity != cash + marketValue");
  if (snapshot.totalPnl !== snapshot.realizedPnl + snapshot.unrealizedPnl) throw new Error("Accounting invariant 失敗：totalPnl != realizedPnl + unrealizedPnl");
  if (snapshot.cash < 0 || snapshot.marketValue < 0 || !Number.isFinite(snapshot.equity)) throw new Error("Accounting invariant 失敗：cash／marketValue／equity");
  for (const position of Object.values(snapshot.positions)) {
    if (!Number.isInteger(position.qty) || position.qty <= 0 || !Number.isFinite(position.avgCost) || position.avgCost <= 0 || position.marketValue < 0) {
      throw new Error("Accounting invariant 失敗：position");
    }
  }
  return true;
}
