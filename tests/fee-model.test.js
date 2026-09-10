import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStorage, PaperBroker } from "../js/paper.js";
import { createAccountSnapshot, assertAccountingInvariants } from "../js/accounting.js";

test("FeeModel pluggability: fixed-percent fee model produces fees and preserves invariants", () => {
  const FIXED_PERCENT_FEE_MODEL = Object.freeze({
    name: "fixed-percent-0.1425",
    calculate: (ctx) => ctx.notional * 0.001425,
  });

  const broker = new PaperBroker({
    storage: new MemoryStorage(),
    now: () => "2025-01-02T09:00:00.000Z",
    feeModel: FIXED_PERCENT_FEE_MODEL,
  });

  // Buy 100 shares @ 100
  const buyOrder = broker.placeOrder({
    market: "TW",
    symbol: "2330",
    side: "buy",
    qty: 100,
    price: 100,
    clientOrderId: "fee-test-buy",
  });

  // Verify buy order has fee
  const buyFee = buyOrder.fee;
  assert.ok(buyFee > 0, `buy fee should be > 0, got ${buyFee}`);
  assert.equal(buyFee, 100 * 100 * 0.001425);

  // Sell 100 shares @ 120
  const sellOrder = broker.placeOrder({
    market: "TW",
    symbol: "2330",
    side: "sell",
    qty: 100,
    price: 120,
    clientOrderId: "fee-test-sell",
  });

  // Verify sell order has fee
  const sellFee = sellOrder.fee;
  assert.ok(sellFee > 0, `sell fee should be > 0, got ${sellFee}`);
  assert.equal(sellFee, 120 * 100 * 0.001425);

  // Snapshot with quotes
  const snapshot = broker.snapshot("TW", { "2330": { price: 120 } });

  // Total fees should be sum of both
  const expectedTotalFees = buyFee + sellFee;
  assert.equal(snapshot.totalFees, expectedTotalFees, `totalFees should be ${expectedTotalFees}, got ${snapshot.totalFees}`);
  assert.ok(snapshot.totalFees > 0, "totalFees should be > 0");

  // Fee model recorded correctly
  assert.equal(snapshot.feeModel, "fixed-percent-0.1425");

  // Accounting invariants must hold
  assertAccountingInvariants(snapshot);

  // Verify specific invariants
  assert.equal(snapshot.equity, snapshot.cash + snapshot.marketValue);
  assert.equal(snapshot.totalPnl, snapshot.realizedPnl + snapshot.unrealizedPnl);
  assert.ok(snapshot.cash >= 0);
  assert.ok(snapshot.marketValue >= 0);
  assert.ok(Number.isFinite(snapshot.equity));

  // Verify cash math: initial 1,000,000 - buy_cost - buy_fee + sell_proceeds - sell_fee
  const buyCost = 100 * 100;
  const sellProceeds = 120 * 100;
  const expectedCash = 1_000_000 - buyCost - buyFee + sellProceeds - sellFee;
  assert.equal(snapshot.cash, expectedCash, `cash should be ${expectedCash}, got ${snapshot.cash}`);

  // Verify realized PnL: (120 - 100) * 100 - buyFee - sellFee = 2000 - fees
  const expectedRealized = (120 - 100) * 100 - buyFee - sellFee;
  const realizedDiff = Math.abs(snapshot.realizedPnl - expectedRealized);
  assert.ok(realizedDiff < 1e-10, `realizedPnl should be ${expectedRealized}, got ${snapshot.realizedPnl}`);
});

test("FeeModel pluggability: zero-fee-paper default unchanged", () => {
  const broker = new PaperBroker({
    storage: new MemoryStorage(),
    now: () => "2025-01-02T09:00:00.000Z",
  });

  broker.placeOrder({
    market: "TW",
    symbol: "2330",
    side: "buy",
    qty: 100,
    price: 100,
    clientOrderId: "default-buy",
  });

  broker.placeOrder({
    market: "TW",
    symbol: "2330",
    side: "sell",
    qty: 100,
    price: 120,
    clientOrderId: "default-sell",
  });

  const snapshot = broker.snapshot("TW", { "2330": { price: 120 } });

  // Default must remain zero-fee-paper with zero fees
  assert.equal(snapshot.feeModel, "zero-fee-paper");
  assert.equal(snapshot.totalFees, 0);

  // Invariants hold
  assertAccountingInvariants(snapshot);
});

test("FeeModel pluggability: custom fee model validates negative fees rejected at order placement", () => {
  const INVALID_FEE_MODEL = Object.freeze({
    name: "invalid-negative",
    calculate: () => -100,
  });

  const broker = new PaperBroker({
    storage: new MemoryStorage(),
    now: () => "2025-01-02T09:00:00.000Z",
    feeModel: INVALID_FEE_MODEL,
  });

  assert.throws(
    () => broker.placeOrder({
      market: "TW",
      symbol: "2330",
      side: "buy",
      qty: 100,
      price: 100,
      clientOrderId: "fee-test-invalid",
    }),
    /FeeModel 回傳無效費用/
  );
});

test("FeeModel pluggability: custom fee model validates non-function calculate rejected at order placement", () => {
  const INVALID_FEE_MODEL = Object.freeze({
    name: "invalid-no-calculate",
    calculate: "not a function",
  });

  const broker = new PaperBroker({
    storage: new MemoryStorage(),
    now: () => "2025-01-02T09:00:00.000Z",
    feeModel: INVALID_FEE_MODEL,
  });

  assert.throws(
    () => broker.placeOrder({
      market: "TW",
      symbol: "2330",
      side: "buy",
      qty: 100,
      price: 100,
      clientOrderId: "fee-test-invalid2",
    }),
    /FeeModel 必須提供 calculate/
  );
});