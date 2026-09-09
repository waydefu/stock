/* Deterministic paper-order state machine. Immediate fills are explicit simulation semantics. */
import { OrderError, ORDER_ERROR_CODE } from "./order-errors.js";
"use strict";

export const ORDER_STATUS = Object.freeze({
  NEW: "NEW",
  VALIDATED: "VALIDATED",
  OPEN: "OPEN",
  FILLED: "FILLED",
  REJECTED: "REJECTED",
  CANCELED: "CANCELED",
});

const TRANSITIONS = Object.freeze({
  NEW: Object.freeze({ VALIDATE: ORDER_STATUS.VALIDATED, REJECT: ORDER_STATUS.REJECTED }),
  VALIDATED: Object.freeze({ OPEN: ORDER_STATUS.OPEN, FILL: ORDER_STATUS.FILLED, REJECT: ORDER_STATUS.REJECTED, CANCEL: ORDER_STATUS.CANCELED }),
  OPEN: Object.freeze({ FILL: ORDER_STATUS.FILLED, CANCEL: ORDER_STATUS.CANCELED }),
  FILLED: Object.freeze({}),
  REJECTED: Object.freeze({}),
  CANCELED: Object.freeze({}),
});

export function createOrder(fields, { now = () => new Date().toISOString() } = {}) {
  return { ...fields, status: ORDER_STATUS.NEW, events: [], createdAt: now() };
}

export function transitionOrder(order, type, { now = () => new Date().toISOString(), reason = "" } = {}) {
  const next = TRANSITIONS[order.status]?.[type];
  if (!next) throw new OrderError(ORDER_ERROR_CODE.INVALID_TRANSITION, `invalid order transition: ${order.status} -> ${type}`);
  const event = { type, from: order.status, to: next, timestamp: now(), reason: String(reason) };
  return { ...order, status: next, events: [...(order.events ?? []), event], updatedAt: event.timestamp };
}

export { TRANSITIONS };
