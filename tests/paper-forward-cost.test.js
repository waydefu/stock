import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStorage, PaperBroker } from "../js/paper.js";
import { createPaperFeeModel } from "../js/paper-fee-model.js";
import { createAppPaperRuntime } from "../js/paper-runtime.js";

test("paper fee policy charges sourced TW costs and keeps US zero-fee explicitly", () => {
  const model = createPaperFeeModel();
  const twBuy = model.calculate({ market: "TW", side: "buy", price: 100, qty: 1000 });
  const twSell = model.calculate({ market: "TW", side: "sell", price: 100, qty: 1000 });
  const usBuy = model.calculate({ market: "US", side: "buy", price: 100, qty: 10 });
  assert.ok(twBuy > 0);
  assert.ok(twSell > twBuy, "ordinary TW sell includes securities transaction tax");
  assert.equal(usBuy, 0);
  assert.throws(() => model.calculate({ market: "JP", side: "buy", price: 100, qty: 1 }), /不支援/);
});

test("app paper runtime injects non-zero TW fee policy without changing PaperBroker default globally", () => {
  const { broker, feeModel } = createAppPaperRuntime({
    storage: new MemoryStorage(),
    now: () => "2026-10-23T01:00:00.000Z",
  });
  const fill = broker.placeOrder({
    market: "TW", symbol: "2330", side: "buy", qty: 1, price: 100,
    lot: "oddLot", clientOrderId: "paper-fee-runtime-1",
  });
  assert.equal(fill.feeModel, feeModel.name);
  assert.ok(fill.fee > 0);
  const account = broker.snapshot("TW", { "2330": { price: 100 } });
  assert.equal(account.totalFees, fill.fee);
  assert.ok(account.cash < 1_000_000 - 100);

  const zeroFeeBroker = new PaperBroker({ storage: new MemoryStorage(), now: () => "2026-10-23T01:00:00.000Z" });
  const defaultFill = zeroFeeBroker.placeOrder({
    market: "TW", symbol: "2330", side: "buy", qty: 1, price: 100,
    lot: "oddLot", clientOrderId: "paper-zero-default-1",
  });
  assert.equal(defaultFill.fee, 0, "domain/test constructor default remains deterministic zero-fee");
});

test("app paper runtime keeps US fee assumption explicit and zero until sourced", () => {
  const { broker } = createAppPaperRuntime({
    storage: new MemoryStorage(),
    now: () => "2026-10-23T14:30:00.000Z",
  });
  const fill = broker.placeOrder({
    market: "US", symbol: "AAPL", side: "buy", qty: 1, price: 100,
    lot: "regular", clientOrderId: "paper-fee-runtime-us-1",
  });
  assert.equal(fill.fee, 0);
});
