"use strict";

import { transitionOrder } from "./order-state.js";

export const ExecutionMode = Object.freeze({
  IMMEDIATE: "IMMEDIATE",
  MATCHING: "MATCHING",
});

export class ImmediateExecutionModel {
  mode = ExecutionMode.IMMEDIATE;

  execute(order, { timestamp = new Date().toISOString(), reason = "immediate paper simulation" } = {}) {
    const now = () => timestamp;
    const validated = order.status === "NEW" ? transitionOrder(order, "VALIDATE", { now }) : order;
    return transitionOrder(validated, "FILL", { now, reason });
  }
}

export function createExecutionModel(mode = ExecutionMode.IMMEDIATE) {
  if (mode === ExecutionMode.IMMEDIATE) return new ImmediateExecutionModel();
  if (mode === ExecutionMode.MATCHING) throw new Error("MATCHING execution model not implemented");
  throw new Error(`不支援 execution mode：${mode}`);
}
