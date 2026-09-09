import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStorage, PaperBroker } from "../js/paper.js";

test("PaperBroker account snapshots use market-local session keys", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => "2025-01-03T01:00:00.000Z" });
  assert.equal(broker.snapshot("TW").sessionKey, "2025-01-03");
  assert.equal(broker.snapshot("US").sessionKey, "2025-01-02");
});

function makeBroker() {
  return new PaperBroker({ storage: new MemoryStorage(), now: () => "2025-01-02T09:00:00.000Z" });
}

test("AccountSnapshot reconciles cash, market value, equity, and PnL", () => {
  const broker = makeBroker();
  broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 100, price: 100, clientOrderId: "account-buy" });
  const snapshot = broker.snapshot("TW", { "2330": { price: 110 } });

  assert.equal(snapshot.market, "TW");
  assert.equal(snapshot.currency, "TWD");
  assert.equal(snapshot.cash, 990_000);
  assert.equal(snapshot.marketValue, 11_000);
  assert.equal(snapshot.equity, 1_001_000);
  assert.equal(snapshot.realizedPnl, 0);
  assert.equal(snapshot.unrealizedPnl, 1_000);
  assert.equal(snapshot.totalPnl, 1_000);
  assert.equal(snapshot.dailyPnl, 1_000);
  assert.equal(snapshot.totalFees, 0);
  assert.equal(snapshot.feeModel, "zero-fee-paper");
  assert.equal(snapshot.equity, snapshot.cash + snapshot.marketValue);
  assert.equal(snapshot.totalPnl, snapshot.realizedPnl + snapshot.unrealizedPnl);
});

test("partial sell realizes only the closed quantity and preserves remaining cost basis", () => {
  const broker = makeBroker();
  broker.placeOrder({ market: "TW", symbol: "2330", side: "buy", qty: 100, price: 100, clientOrderId: "partial-buy" });
  broker.placeOrder({ market: "TW", symbol: "2330", side: "sell", qty: 40, price: 120, clientOrderId: "partial-sell" });
  const snapshot = broker.snapshot("TW", { "2330": { price: 110 } });

  assert.equal(snapshot.positions["2330"].qty, 60);
  assert.equal(snapshot.positions["2330"].avgCost, 100);
  assert.equal(snapshot.positions["2330"].unrealized, 600);
  assert.equal(snapshot.realizedPnl, 800);
  assert.equal(snapshot.unrealizedPnl, 600);
  assert.equal(snapshot.totalPnl, 1_400);
  assert.equal(snapshot.equity, 1_001_400);
});

test("full sell retains realized PnL after the position disappears", () => {
  const broker = makeBroker();
  broker.placeOrder({ market: "US", symbol: "AAPL", side: "buy", qty: 10, price: 100, clientOrderId: "full-buy" });
  broker.placeOrder({ market: "US", symbol: "AAPL", side: "sell", qty: 10, price: 90, clientOrderId: "full-sell" });
  const snapshot = broker.snapshot("US", { AAPL: { price: 90 } });

  assert.deepEqual(snapshot.positions, {});
  assert.equal(snapshot.marketValue, 0);
  assert.equal(snapshot.unrealizedPnl, 0);
  assert.equal(snapshot.realizedPnl, -100);
  assert.equal(snapshot.totalPnl, -100);
  assert.equal(snapshot.equity, 99_900);
});
