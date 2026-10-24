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

test("matching execution model opens first and fills only on last-trade touch", () => {
  const model = createExecutionModel(ExecutionMode.MATCHING);
  const order = createOrder({ id: "P-MATCH", market: "TW", symbol: "2330", side: "buy", qty: 10, price: 100, orderType: "limit" });
  const open = model.execute(order, { timestamp: "2025-01-01T00:00:01.000Z" });
  assert.equal(open.status, ORDER_STATUS.OPEN);
  assert.deepEqual(open.events.map((event) => event.type), ["VALIDATE", "OPEN"]);
  assert.equal(model.match(open, { price: 101 }).matched, false);
  const touch = model.match(open, { price: 99 });
  assert.equal(touch.matched, true);
  assert.equal(touch.fillPrice, 100, "v1 does not invent price improvement");
  assert.throws(() => model.fill(open, { price: 99 }), /submitted limit/);
  const filled = model.fill(open, { timestamp: "2025-01-01T00:00:02.000Z", price: touch.fillPrice });
  assert.equal(filled.status, ORDER_STATUS.FILLED);
  assert.equal(filled.filledQty, 10);
  assert.equal(filled.remainingQty, 0);
  assert.equal(filled.fillPrice, 100);
});
