/* Paper execution boundary.
   Preview is advisory; commit re-reads account/risk immediately before mutation.
   Matching fills also revalidate risk at the actual match boundary. */
"use strict";

import { matchLimitOrder } from "./execution-model.js";
import { ORDER_ERROR_CODE } from "./order-errors.js";
import { ORDER_STATUS } from "./order-state.js";
import { reconcilePaperFill } from "./paper-reconciliation.js";

function roleDenied() {
  return { ok: false, code: "ROLE_DENIED", category: "AUTHORIZATION_REJECTED", reason: "目前角色沒有紙上交易權限" };
}

export function executePaperOrder({ broker, risk, order, quotes = {}, canTrade = true, now } = {}) {
  if (!canTrade) return { accepted: false, filled: false, decision: roleDenied() };

  const previous = broker.findOrder(order.market, order.clientOrderId);
  if (previous) {
    const filled = previous.status === ORDER_STATUS.FILLED;
    return {
      accepted: [ORDER_STATUS.OPEN, ORDER_STATUS.FILLED].includes(previous.status),
      filled,
      duplicate: true,
      decision: { ok: true, code: ORDER_ERROR_CODE.IDEMPOTENT_REPLAY, reason: "重複 clientOrderId，回傳原訂單" },
      order: previous,
      fill: filled ? previous : null,
      account: broker.snapshot(order.market, quotes),
    };
  }

  const account = broker.snapshot(order.market, quotes);
  const decision = risk.approveOrder(account, order, { now: now ?? Date.now() });
  if (!decision.ok) return { accepted: false, filled: false, decision: { ...decision, category: "RISK_REJECTED" }, account };

  try {
    const placed = broker.placeOrder(order);
    const filled = placed.status === ORDER_STATUS.FILLED;
    return {
      accepted: [ORDER_STATUS.OPEN, ORDER_STATUS.FILLED].includes(placed.status),
      filled,
      decision,
      order: placed,
      fill: filled ? placed : null,
      account: broker.snapshot(order.market, quotes),
    };
  } catch (error) {
    return {
      accepted: false,
      filled: false,
      decision: { ok: false, code: error?.code ?? "BROKER_REJECTED", category: "BROKER_REJECTED", reason: error.message },
      account,
    };
  }
}

export function cancelPaperOrder({ broker, market = "TW", orderId, canTrade = true, now = Date.now(), reason = "user request" } = {}) {
  if (!canTrade) return { canceled: false, decision: roleDenied() };
  try {
    const order = broker.cancelOrder(market, orderId, { timestamp: new Date(now).toISOString(), reason });
    return { canceled: true, order, account: broker.snapshot(market) };
  } catch (error) {
    return {
      canceled: false,
      decision: { ok: false, code: error?.code ?? "BROKER_REJECTED", category: "BROKER_REJECTED", reason: error?.message ?? "cancel failed" },
    };
  }
}

export function processPaperMatches({ broker, risk, market = "TW", quotes = {}, canTrade = true, now = Date.now() } = {}) {
  const timestamp = new Date(now).toISOString();
  const expired = broker.expireOpenOrders(market, { timestamp });
  const fills = [];
  const canceled = [];
  const failures = [];

  for (const order of broker.openOrders(market)) {
    if (!canTrade) {
      canceled.push(broker.cancelOrder(market, order.id, { timestamp, reason: "ROLE_DENIED at match boundary" }));
      failures.push({ orderId: order.id, decision: roleDenied() });
      continue;
    }

    const quote = quotes[order.symbol];
    const match = matchLimitOrder(order, quote);
    if (!match.matched) continue;

    const before = broker.snapshot(market, quotes);
    const decision = risk.approveOrder(before, { ...order, price: match.fillPrice }, { now });
    if (!decision.ok) {
      canceled.push(broker.cancelOrder(market, order.id, { timestamp, reason: `risk:${decision.code}` }));
      failures.push({ orderId: order.id, decision: { ...decision, category: "RISK_REJECTED" } });
      continue;
    }

    try {
      const fill = broker.fillOpenOrder(market, order.id, {
        price: match.fillPrice,
        timestamp,
        reason: `${match.reason}; observed=${match.observedPrice}; assumption=${match.assumption}`,
      });
      const after = broker.snapshot(market, quotes);
      const reconciliation = reconcilePaperFill({ before, after, fill });
      if (!reconciliation.ok) {
        risk.trip(`MATCH_RECONCILIATION_FAILED:${reconciliation.violations.join(",")}`);
        failures.push({ orderId: order.id, decision: { ok: false, code: "RECONCILIATION_FAILED", category: "RECONCILIATION_FAILED", reason: reconciliation.violations.join(",") }, reconciliation });
      }
      fills.push({ fill, before, after, reconciliation, match });
    } catch (error) {
      const current = broker.findOrderById(market, order.id);
      if (current?.status === ORDER_STATUS.OPEN) {
        canceled.push(broker.cancelOrder(market, order.id, { timestamp, reason: `broker:${error?.code ?? "BROKER_REJECTED"}` }));
      }
      failures.push({
        orderId: order.id,
        decision: { ok: false, code: error?.code ?? "BROKER_REJECTED", category: "BROKER_REJECTED", reason: error?.message ?? "matching fill failed" },
      });
    }
  }

  return {
    fills,
    canceled,
    expired,
    failures,
    open: broker.openOrders(market),
  };
}
