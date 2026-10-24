import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionMode } from "../js/execution-model.js";
import { MemoryStorage, PaperBroker } from "../js/paper.js";
import { RiskEngine } from "../js/risk.js";
import { executePaperOrder, processPaperMatches } from "../js/order-service.js";

const SESSION = Date.parse("2026-10-23T01:10:00.000Z");

function matchingOrder(overrides = {}) {
  return {
    market: "TW",
    symbol: "2330",
    side: "buy",
    qty: 10,
    price: 100,
    lot: "oddLot",
    orderType: "limit",
    timeInForce: "DAY",
    referencePrice: 100,
    executionMode: ExecutionMode.MATCHING,
    clientOrderId: "match-1",
    ...overrides,
  };
}

test("matching order reserves cash without mutating positions until touched", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => new Date(SESSION).toISOString() });
  const risk = new RiskEngine();
  const result = executePaperOrder({
    broker, risk, order: matchingOrder(), quotes: { "2330": { price: 100 } }, now: SESSION,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.filled, false);
  assert.equal(result.order.status, "OPEN");

  const before = broker.snapshot("TW", { "2330": { price: 100 } });
  assert.equal(before.cash, 1_000_000);
  assert.equal(before.positions["2330"], undefined);
  assert.equal(before.reservedCash, 1000);
  assert.equal(before.availableCash, 999000);

  const miss = processPaperMatches({
    broker, risk, market: "TW", quotes: { "2330": { price: 101 } }, now: SESSION,
  });
  assert.equal(miss.fills.length, 0);
  assert.equal(broker.findOrder("TW", "match-1").status, "OPEN");

  const hit = processPaperMatches({
    broker, risk, market: "TW", quotes: { "2330": { price: 95 } }, now: SESSION,
  });
  assert.equal(hit.fills.length, 1);
  assert.equal(hit.fills[0].fill.fillPrice, 100, "conservative v1 fills at submitted limit");
  assert.equal(hit.fills[0].reconciliation.ok, true);

  const after = broker.snapshot("TW", { "2330": { price: 95 } });
  assert.equal(after.positions["2330"].qty, 10);
  assert.equal(after.cash, 999000);
  assert.equal(after.reservedCash, 0);
  assert.equal(after.orders[0].status, "FILLED");
});

test("cancel releases matching reservations", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => new Date(SESSION).toISOString() });
  const order = broker.placeOrder(matchingOrder({ clientOrderId: "cancel-1" }));
  assert.equal(broker.snapshot("TW").reservedCash, 1000);
  const canceled = broker.cancelOrder("TW", order.id, { reason: "user" });
  assert.equal(canceled.status, "CANCELED");
  assert.equal(broker.snapshot("TW").reservedCash, 0);
  assert.equal(broker.snapshot("TW").availableCash, 1_000_000);
});

test("DAY matching order expires before a later session and never mutates cash", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => new Date(SESSION).toISOString() });
  broker.placeOrder(matchingOrder({ clientOrderId: "expire-1" }));
  const expired = broker.expireOpenOrders("TW", { timestamp: "2026-10-27T01:10:00.000Z" });
  assert.equal(expired.length, 1);
  assert.equal(expired[0].status, "EXPIRED");
  const account = broker.snapshot("TW");
  assert.equal(account.cash, 1_000_000);
  assert.equal(account.reservedCash, 0);
});

test("open matching buys reserve cash against later orders", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => new Date(SESSION).toISOString() });
  broker.placeOrder(matchingOrder({ qty: 9000, lot: "regular", clientOrderId: "reserve-big" }));
  assert.throws(
    () => broker.placeOrder(matchingOrder({ qty: 2000, lot: "regular", clientOrderId: "reserve-over" })),
    /可用現金不足/,
  );
});

test("open matching sells reserve position quantity", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => new Date(SESSION).toISOString() });
  broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 100, price: 100, lot: "oddLot", clientOrderId: "seed-pos" });
  broker.placeOrder(matchingOrder({ side: "sell", qty: 80, clientOrderId: "sell-reserve" }));
  assert.throws(
    () => broker.placeOrder(matchingOrder({ side: "sell", qty: 30, clientOrderId: "sell-over" })),
    /可用持倉不足/,
  );
});

test("matching fill revalidates kill switch and cancels instead of mutating ledger", () => {
  const storage = new MemoryStorage();
  const broker = new PaperBroker({ storage, now: () => new Date(SESSION).toISOString() });
  const risk = new RiskEngine({}, { storage });
  executePaperOrder({ broker, risk, order: matchingOrder({ clientOrderId: "risk-recheck" }), quotes: { "2330": { price: 100 } }, now: SESSION });
  risk.trip("test");
  const result = processPaperMatches({ broker, risk, market: "TW", quotes: { "2330": { price: 99 } }, now: SESSION });
  assert.equal(result.fills.length, 0);
  assert.equal(result.canceled.length, 1);
  assert.equal(result.failures[0].decision.code, "KILL_SWITCH");
  assert.equal(broker.snapshot("TW").cash, 1_000_000);
  assert.equal(broker.snapshot("TW").positions["2330"], undefined);
});
