import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStorage, PaperBroker } from "../js/paper.js";
import { AuditLog } from "../js/risk.js";

test("paper broker records a buy and updates cash and position", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => "2025-01-01T00:00:00.000Z" });
  const result = broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 10, price: 100, clientOrderId: "paper-test-1" });
  assert.equal(result.status, "FILLED");
  assert.deepEqual(result.events.map((event) => event.type), ["VALIDATE", "FILL"]);
  const account = broker.snapshot("TW");
  assert.equal(account.positions["2330"].qty, 10);
  assert.equal(account.cash, 999000);
  assert.equal(account.orders.length, 1);
});

test("paper broker rejects a cash overdraft and does not mutate state", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage() });
  assert.throws(() => broker.placeOrder({ market: "US", symbol: "NVDA", side: "buy", qty: 1000, price: 200, clientOrderId: "paper-overdraft" }), /現金不足/);
  assert.equal(broker.snapshot("US").orders.length, 0);
});

test("paper broker can reset one isolated market account", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage() });
  broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 1, price: 100, clientOrderId: "paper-reset" });
  broker.reset("TW");
  assert.equal(broker.snapshot("TW").cash, 1_000_000);
  assert.deepEqual(broker.snapshot("TW").positions, {});
});

test("paper broker discards malformed persisted account state", () => {
  const storage = new MemoryStorage();
  storage.setItem("tw-us-stock-paper-v1", JSON.stringify({
    schemaVersion: 1,
    TW: { cash: "not-a-number", positions: { "2330": { qty: -10, avgCost: "bad" } }, orders: "bad" },
  }));
  const broker = new PaperBroker({ storage });
  const account = broker.snapshot("TW");
  assert.equal(account.cash, 1_000_000);
  assert.deepEqual(account.positions, {});
  assert.deepEqual(account.orders, []);
});

test("paper broker discards malformed persisted orders and duplicate ids", () => {
  const storage = new MemoryStorage();
  storage.setItem("tw-us-stock-paper-v1", JSON.stringify({
    schemaVersion: 1,
    TW: {
      cash: 999_000,
      realizedPnl: 0,
      totalFees: 0,
      feeModel: "zero-fee-paper",
      positions: {},
      orders: [{ id: "same", clientOrderId: "same-client", status: "FILLED", symbol: "2330", side: "buy", qty: -1, price: 100 }, { id: "same", clientOrderId: "same-client", status: "FILLED", symbol: "2330", side: "buy", qty: 1, price: 100 }],
    },
  }));
  const account = new PaperBroker({ storage }).snapshot("TW");
  assert.equal(account.cash, 1_000_000);
  assert.deepEqual(account.orders, []);
});

test("paper broker applies the shared TW lot policy", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage() });
  assert.throws(() => broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 1000, price: 100, clientOrderId: "wrong-default-lot" }), (error) => error.code === "ODD_LOT_RANGE");
  const regular = broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 1000, price: 100, lot: "regular", clientOrderId: "regular-lot" });
  assert.equal(regular.status, "FILLED");
  assert.equal(regular.lot, "regular");
});

test("paper account invariants survive deterministic buy and full sell sequence", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => "2025-01-01T00:00:00.000Z" });
  broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 10, price: 100, clientOrderId: "invariant-buy" });
  broker.placeOrder({ market: "TW", symbol: "2330", side: "sell", qty: 10, price: 110, clientOrderId: "invariant-sell" });
  const snapshot = broker.snapshot("TW", { "2330": { price: 110 } });
  assert.equal(snapshot.positions["2330"], undefined);
  assert.ok(Number.isFinite(snapshot.cash));
  assert.ok(Number.isFinite(snapshot.equity));
  assert.ok(snapshot.cash >= 0);
});

test("paper broker returns the original fill for a duplicate client order id", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => "2025-01-01T00:00:00.000Z" });
  const first = broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 2, price: 100, clientOrderId: "duplicate-1" });
  const duplicate = broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 99, price: 1, clientOrderId: "duplicate-1" });
  assert.deepEqual(duplicate, first);
  assert.equal(broker.snapshot("TW").positions["2330"].qty, 2);
  assert.equal(broker.snapshot("TW").orders.length, 1);
});

test("paper broker emits PERSISTENCE_RESET audit event on schema version mismatch", () => {
  const storage = new MemoryStorage();
  // First, create a valid audit log with some events
  const audit = new AuditLog({ storage, now: () => "2025-01-01T00:00:00.000Z" });
  audit.record("SESSION_OPEN", { mode: "paper" });
  audit.record("ORDER_ACCEPTED", { symbol: "2330" });

  // Now write paper data with wrong schema version
  storage.setItem("tw-us-stock-paper-v1", JSON.stringify({
    schemaVersion: 999,
    TW: { cash: 500000, positions: { "2330": { qty: 100, avgCost: 100 } }, orders: [] },
  }));

  // Create new PaperBroker - should trigger reset and emit PERSISTENCE_RESET
  const broker = new PaperBroker({ storage });
  const account = broker.snapshot("TW");

  // Account should be reset to defaults
  assert.equal(account.cash, 1_000_000);
  assert.deepEqual(account.positions, {});

  // Audit log should have PERSISTENCE_RESET event
  const audit2 = new AuditLog({ storage, now: () => "2025-01-01T00:00:01.000Z" });
  const events = audit2.list();
  const resetEvent = events.find(e => e.event === "PERSISTENCE_RESET");
  assert.ok(resetEvent, "PERSISTENCE_RESET event should exist");
  assert.equal(resetEvent.details.reason, "schema_version_mismatch");
  assert.equal(resetEvent.details.expected, 1);
  assert.equal(resetEvent.details.found, 999);
  });
