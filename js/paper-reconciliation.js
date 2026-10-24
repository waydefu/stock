/* Immediate PaperBroker reconciliation.
   Verifies the ledger mutation produced by a filled paper order before automation continues.
   A mismatch is a safety event: callers should trip the kill switch and stop. */
"use strict";

import { assertAccountingInvariants } from "./accounting.js";

function closeEnough(a, b, epsilon = 1e-6) {
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= epsilon;
}

function qtyOf(snapshot, symbol) {
  return Number(snapshot?.positions?.[symbol]?.qty ?? 0);
}

export function reconcileImmediateFill({ before, after, fill } = {}) {
  const violations = [];
  if (!before || !after || !fill) return { ok: false, violations: ["MISSING_RECONCILIATION_INPUT"] };

  try {
    assertAccountingInvariants(after);
  } catch (error) {
    violations.push(`ACCOUNTING_INVARIANT:${error.message}`);
  }

  const notional = Number(fill.notional ?? Number(fill.price) * Number(fill.qty));
  const fee = Number(fill.fee ?? 0);
  const expectedCash = fill.side === "buy"
    ? Number(before.cash) - notional - fee
    : Number(before.cash) + notional - fee;
  if (!closeEnough(Number(after.cash), expectedCash)) violations.push("CASH_MISMATCH");

  const beforeQty = qtyOf(before, fill.symbol);
  const expectedQty = fill.side === "buy" ? beforeQty + fill.qty : beforeQty - fill.qty;
  if (qtyOf(after, fill.symbol) !== expectedQty) violations.push("POSITION_QTY_MISMATCH");

  if (!closeEnough(Number(after.totalFees), Number(before.totalFees) + fee)) violations.push("FEE_TOTAL_MISMATCH");
  if (!Array.isArray(after.orders) || !after.orders.some((order) => order.id === fill.id && order.clientOrderId === fill.clientOrderId)) {
    violations.push("ORDER_LEDGER_MISSING");
  }

  return { ok: violations.length === 0, violations };
}
