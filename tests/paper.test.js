import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStorage, PaperBroker } from "../js/paper.js";

test("paper broker records a buy and updates cash and position", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => "2025-01-01T00:00:00.000Z" });
  const result = broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 10, price: 100 });
  assert.equal(result.status, "filled");
  const account = broker.snapshot("TW");
  assert.equal(account.positions["2330"].qty, 10);
  assert.equal(account.cash, 999000);
  assert.equal(account.orders.length, 1);
});

test("paper broker rejects a cash overdraft and does not mutate state", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage() });
  assert.throws(() => broker.placeOrder({ market: "US", symbol: "NVDA", side: "buy", qty: 1000, price: 200 }), /現金不足/);
  assert.equal(broker.snapshot("US").orders.length, 0);
});

test("paper broker can reset one isolated market account", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage() });
  broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 1, price: 100 });
  broker.reset("TW");
  assert.equal(broker.snapshot("TW").cash, 1_000_000);
  assert.deepEqual(broker.snapshot("TW").positions, {});
});
