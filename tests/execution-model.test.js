import assert from "node:assert/strict";
import test from "node:test";
import { createExecutionModel, ExecutionMode } from "../js/execution-model.js";
import { createOrder, ORDER_STATUS } from "../js/order-state.js";

test("immediate execution model produces explicit validated-to-filled events", () => {
  const model = createExecutionModel(ExecutionMode.IMMEDIATE);
  const order = createOrder({ id: "P-IMMEDIATE", market: "TW", symbol: "2330", side: "buy", qty: 1, price: 100 });
  const result = model.execute(order, { timestamp: "2025-01-01T00:00:01.000Z" });
  assert.equal(model.mode, ExecutionMode.IMMEDIATE);
  assert.equal(result.status, ORDER_STATUS.FILLED);
  assert.deepEqual(result.events.map((event) => event.type), ["VALIDATE", "FILL"]);
  assert.equal(result.events.at(-1).reason, "immediate paper simulation");
});

test("matching execution mode is reserved but not silently simulated", () => {
  assert.throws(() => createExecutionModel(ExecutionMode.MATCHING), /not implemented/i);
});
