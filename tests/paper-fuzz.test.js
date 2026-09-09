import assert from "node:assert/strict";
import test from "node:test";
import { mulberry32, seedFromString } from "../js/data.js";
import { MemoryStorage, PaperBroker } from "../js/paper.js";

function stateDigest(snapshot) {
  return JSON.stringify({ cash: snapshot.cash, positions: snapshot.positions, orders: snapshot.orders });
}

test("deterministic paper fuzz preserves accounting invariants across 1000 intents", () => {
  const broker = new PaperBroker({ storage: new MemoryStorage(), now: () => "2025-01-02T09:00:00.000Z" });
  const random = mulberry32(seedFromString("paper-account-fuzz-v1"));
  const symbols = ["2330", "2317", "2454"];

  for (let index = 0; index < 1_000; index += 1) {
    const symbol = symbols[Math.floor(random() * symbols.length)];
    const side = random() < 0.55 ? "buy" : "sell";
    const qty = 1 + Math.floor(random() * 25);
    const price = 50 + Math.floor(random() * 250);
    const before = broker.snapshot("TW");
    try {
      broker.placeOrder({ market: "TW", symbol, side, qty, price, clientOrderId: `fuzz-${index}` });
    } catch (error) {
      assert.ok(["INSUFFICIENT_CASH", "INSUFFICIENT_POSITION"].includes(error.code), `unexpected fuzz rejection: ${error.code}`);
      assert.equal(stateDigest(broker.snapshot("TW")), stateDigest(before));
    }

    const after = broker.snapshot("TW");
    assert.ok(Number.isFinite(after.cash));
    assert.ok(Number.isFinite(after.marketValue));
    assert.ok(Number.isFinite(after.equity));
    assert.ok(Number.isFinite(after.realizedPnl));
    assert.ok(Number.isFinite(after.unrealizedPnl));
    assert.equal(after.equity, after.cash + after.marketValue);
    assert.equal(after.totalPnl, after.realizedPnl + after.unrealizedPnl);
    for (const position of Object.values(after.positions)) {
      assert.ok(Number.isInteger(position.qty) && position.qty > 0);
      assert.ok(Number.isFinite(position.avgCost) && position.avgCost > 0);
      assert.ok(position.marketValue >= 0);
    }
  }
});
