import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStorage, PaperBroker } from "../js/paper.js";
import { executePaperOrder } from "../js/order-service.js";
import { RiskEngine } from "../js/risk.js";
import { createOrder, transitionOrder } from "../js/order-state.js";

test("paper validation errors expose stable codes", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage() });
  assert.throws(() => broker.placeOrder({ market: "TW", symbol: "bad symbol", side: "buy", qty: 1, price: 100, clientOrderId: "invalid-symbol" }), (error) => error.code === "INVALID_SYMBOL");
  assert.throws(() => transitionOrder(createOrder({ id: "P-error", market: "TW", symbol: "2330" }), "FILL"), (error) => error.code === "INVALID_TRANSITION");
});

test("execution service preserves broker rejection category and code", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage() });
  const risk = new RiskEngine();
  const result = executePaperOrder({
    broker,
    risk,
    order: { market: "TW", symbol: "2330", side: "buy", qty: 1, price: 100, clientOrderId: "broker-invalid" },
  });
  assert.equal(result.filled, true);

  const rejected = executePaperOrder({
    broker,
    risk,
    order: { market: "TW", symbol: "2330", side: "buy", qty: 1, price: 100, clientOrderId: "broker-invalid-2" },
    canTrade: false,
  });
  assert.equal(rejected.filled, false);
  assert.equal(rejected.decision.code, "ROLE_DENIED");
  assert.equal(rejected.decision.category, "AUTHORIZATION_REJECTED");
});
