/* Paper execution boundary.
   Preview is advisory; this function re-reads account state and risk immediately before mutation. */
"use strict";

export function executePaperOrder({ broker, risk, order, quotes = {}, canTrade = true }) {
  if (!canTrade) {
    return {
      filled: false,
      decision: { ok: false, code: "ROLE_DENIED", reason: "目前角色沒有紙上交易權限" },
    };
  }
  const account = broker.snapshot(order.market, quotes);
  const decision = risk.approveOrder(account, order);
  if (!decision.ok) return { filled: false, decision, account };
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
      decision: { ok: false, code: "BROKER_REJECTED", reason: error.message },
      account,
    };
  }
}
