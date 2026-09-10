import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStorage, PaperBroker } from "../js/paper.js";
import { RiskEngine } from "../js/risk.js";
import { executePaperOrder } from "../js/order-service.js";

test("paper snapshot wires session daily PnL into the account contract", () => {
  let now = "2025-01-02T09:00:00.000Z";
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => now });
  const initial = broker.snapshot("TW", {});
  assert.equal(initial.dailyPnl, 0);
  assert.equal(initial.dailyLossReferenceEquity, 1_000_000);

  broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 10, price: 100, clientOrderId: "daily-pnl-seed" });
  const marked = broker.snapshot("TW", { "2330": { price: 90 } });
  assert.equal(marked.equity, 999_900);
  assert.equal(marked.dailyPnl, -100);

  now = "2025-01-03T09:00:00.000Z";
  const nextSession = broker.snapshot("TW", { "2330": { price: 90 } });
  assert.equal(nextSession.dailyPnl, 0);
  assert.equal(nextSession.dailyLossReferenceEquity, 999_900);
});

test("execution boundary rechecks cash after a preview becomes stale", () => {
  const timestamp = new Date("2025-01-06T01:00:00.000Z").getTime(); // Monday 09:00 Taipei
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => new Date(timestamp).toISOString() });
  const risk = new RiskEngine({ maxOrderNotionalPct: 0.2 });
  const candidate = { market: "TW", symbol: "2330", side: "buy", qty: 2_000, price: 100, lot: "regular", clientOrderId: "stale-order", referencePrice: 100, timestamp };

  // Simulate another trusted paper operation changing account cash after preview.
  broker.placeOrder({ market: "TW", symbol: "2317", side: "buy", qty: 9_000, price: 100, lot: "regular", clientOrderId: "stale-cash-seed", referencePrice: 100 });
  const result = executePaperOrder({ broker, risk, order: candidate });

  assert.equal(result.filled, false);
  assert.equal(result.decision.code, "INSUFFICIENT_CASH");
  assert.equal(broker.snapshot("TW").orders.length, 1);
});

test("execution boundary rechecks the kill switch at confirm time", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage() });
  const risk = new RiskEngine();
  risk.trip("confirm race test");
  const result = executePaperOrder({
    broker,
    risk,
    order: { market: "TW", symbol: "2330", side: "buy", qty: 1, price: 100, referencePrice: 100, orderType: "limit", clientOrderId: "kill-switch-confirm" },
  });

  assert.equal(result.filled, false);
  assert.equal(result.decision.code, "KILL_SWITCH");
  assert.equal(broker.snapshot("TW").orders.length, 0);
});
