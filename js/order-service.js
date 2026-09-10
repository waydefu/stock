/* Paper execution boundary.
   Preview is advisory; this function re-reads account state and risk immediately before mutation. */
"use strict";

import { ORDER_ERROR_CODE } from "./order-errors.js";

export function executePaperOrder({ broker, risk, order, quotes = {}, canTrade = true, now } = {}) {
  if (!canTrade) {
    return {
      filled: false,
      decision: { ok: false, code: "ROLE_DENIED", category: "AUTHORIZATION_REJECTED", reason: "目前角色沒有紙上交易權限" },
    };
  }
  const previous = broker.findOrder(order.market, order.clientOrderId);
  if (previous) {
    return {
      filled: true,
      duplicate: true,
      decision: { ok: true, code: ORDER_ERROR_CODE.IDEMPOTENT_REPLAY, reason: "重複 clientOrderId，回傳原成交" },
      fill: previous,
      account: broker.snapshot(order.market, quotes),
    };
  }
  const account = broker.snapshot(order.market, quotes);
  // Commit-time clock: session revalidation must see now, not a stale preview timestamp.
  const decision = risk.approveOrder(account, order, { now: now ?? Date.now() });
  if (!decision.ok) return { filled: false, decision: { ...decision, category: "RISK_REJECTED" }, account };
  try {
    const fill = broker.placeOrder(order);
    return {
      filled: true,
      decision,
      fill,
      account: broker.snapshot(order.market, quotes),
    };
  } catch (error) {
    return {
      filled: false,
      decision: { ok: false, code: error?.code ?? "BROKER_REJECTED", category: "BROKER_REJECTED", reason: error.message },
      account,
    };
  }
}
