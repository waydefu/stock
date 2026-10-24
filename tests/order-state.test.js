import assert from "node:assert/strict";
import test from "node:test";
import { createOrder, ORDER_STATUS, transitionOrder } from "../js/order-state.js";

test("paper order follows explicit new → validated → filled transitions", () => {
  const created = createOrder({ id: "P-1", market: "TW", symbol: "2330", side: "buy", qty: 1, price: 100 }, { now: () => "2025-01-01T00:00:00.000Z" });
  assert.equal(created.status, ORDER_STATUS.NEW);
  const validated = transitionOrder(created, "VALIDATE", { now: () => "2025-01-01T00:00:01.000Z" });
  const filled = transitionOrder(validated, "FILL", { now: () => "2025-01-01T00:00:02.000Z", reason: "immediate paper simulation" });
  assert.equal(filled.status, ORDER_STATUS.FILLED);
  assert.deepEqual(filled.events.map((event) => event.type), ["VALIDATE", "FILL"]);
  assert.equal(filled.events.at(-1).reason, "immediate paper simulation");
});

test("state machine supports open lifecycle and rejects terminal-state resurrection", () => {
  const created = createOrder({ id: "P-3", market: "TW", symbol: "2330", side: "buy", qty: 1, price: 100 });
  const validated = transitionOrder(created, "VALIDATE");
  const open = transitionOrder(validated, "OPEN", { reason: "matching model submitted" });
  const canceled = transitionOrder(open, "CANCEL", { reason: "user request" });
  assert.equal(canceled.status, ORDER_STATUS.CANCELED);
  assert.throws(() => transitionOrder(canceled, "FILL"), /invalid order transition/i);

  const rejected = transitionOrder(createOrder({ id: "P-2", market: "US", symbol: "AAPL", side: "buy", qty: 1, price: 100 }), "REJECT", { reason: "risk" });
  assert.equal(rejected.status, ORDER_STATUS.REJECTED);
  assert.throws(() => transitionOrder(rejected, "FILL"), /invalid order transition/i);

  const filled = transitionOrder(validated, "FILL");
  assert.throws(() => transitionOrder(filled, "OPEN"), /invalid order transition/i);
  assert.throws(() => transitionOrder(filled, "CANCEL"), /invalid order transition/i);
});


test("open DAY order can expire and terminal expiry cannot resurrect", () => {
  const created = createOrder({ id: "P-EXP", market: "TW", symbol: "2330", side: "buy", qty: 1, price: 100 });
  const validated = transitionOrder(created, "VALIDATE");
  const open = transitionOrder(validated, "OPEN");
  const expired = transitionOrder(open, "EXPIRE", { reason: "DAY expired" });
  assert.equal(expired.status, ORDER_STATUS.EXPIRED);
  assert.equal(expired.events.at(-1).type, "EXPIRE");
  assert.throws(() => transitionOrder(expired, "FILL"), /invalid order transition/i);
});
