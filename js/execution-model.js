/* Paper execution models.
   IMMEDIATE preserves legacy behavior.
   MATCHING v1 is deterministic full-fill limit matching using last-trade touch:
   buy matches when observed price <= limit; sell when observed price >= limit.
   Fill price is the submitted limit (no invented price improvement).
   No L2 queue/volume => no partial fills in v1. */
"use strict";

import { ORDER_STATUS, transitionOrder } from "./order-state.js";

export const ExecutionMode = Object.freeze({
  IMMEDIATE: "IMMEDIATE",
  MATCHING: "MATCHING",
});

function filledShape(order, { timestamp, price, reason }) {
  const filled = transitionOrder(order, "FILL", { now: () => timestamp, reason });
  return {
    ...filled,
    filledQty: order.qty,
    remainingQty: 0,
    avgFillPrice: price,
    fillPrice: price,
    filledAt: timestamp,
    notional: order.qty * price,
  };
}

export class ImmediateExecutionModel {
  mode = ExecutionMode.IMMEDIATE;

  execute(order, { timestamp = new Date().toISOString(), reason = "immediate paper simulation" } = {}) {
    const now = () => timestamp;
    const validated = order.status === ORDER_STATUS.NEW ? transitionOrder(order, "VALIDATE", { now }) : order;
    return filledShape(validated, { timestamp, price: order.price, reason });
  }
}

export class MatchingExecutionModel {
  mode = ExecutionMode.MATCHING;

  execute(order, { timestamp = new Date().toISOString(), reason = "matching order accepted" } = {}) {
    const now = () => timestamp;
    const validated = order.status === ORDER_STATUS.NEW ? transitionOrder(order, "VALIDATE", { now }) : order;
    return transitionOrder(validated, "OPEN", { now, reason });
  }

  match(order, { price } = {}) {
    if (order?.status !== ORDER_STATUS.OPEN) return { matched: false, reason: "ORDER_NOT_OPEN" };
    if (order?.orderType !== "limit") return { matched: false, reason: "MATCHING_V1_LIMIT_ONLY" };
    if (!Number.isFinite(price) || price <= 0) return { matched: false, reason: "INVALID_OBSERVED_PRICE" };
    const crossed = order.side === "buy" ? price <= order.price : price >= order.price;
    return {
      matched: crossed,
      reason: crossed ? "LAST_TRADE_TOUCHED_LIMIT" : "LIMIT_NOT_TOUCHED",
      observedPrice: price,
      fillPrice: crossed ? order.price : null,
      assumption: "last-trade-touch/full-fill-at-limit/no-l2-queue",
    };
  }

  fill(order, { timestamp = new Date().toISOString(), price = order.price, reason = "last-trade touch" } = {}) {
    if (order?.status !== ORDER_STATUS.OPEN) throw new Error("matching fill requires OPEN order");
    if (!Number.isFinite(price) || price <= 0) throw new Error("matching fill requires valid price");
    return filledShape(order, { timestamp, price, reason });
  }

  cancel(order, { timestamp = new Date().toISOString(), reason = "user request" } = {}) {
    return transitionOrder(order, "CANCEL", { now: () => timestamp, reason });
  }

  expire(order, { timestamp = new Date().toISOString(), reason = "DAY order expired" } = {}) {
    return transitionOrder(order, "EXPIRE", { now: () => timestamp, reason });
  }
}

export function matchLimitOrder(order, quote) {
  return new MatchingExecutionModel().match(order, { price: Number(quote?.price) });
}

export function createExecutionModel(mode = ExecutionMode.IMMEDIATE) {
  if (mode === ExecutionMode.IMMEDIATE) return new ImmediateExecutionModel();
  if (mode === ExecutionMode.MATCHING) return new MatchingExecutionModel();
  throw new Error(`不支援 execution mode：${mode}`);
}
