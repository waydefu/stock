import assert from "node:assert/strict";
import test from "node:test";
import { RiskEngine } from "../js/risk.js";

test("risk engine rejects malformed order fields before notional checks", () => {
  const risk = new RiskEngine();
  const account = { equity: 10000, cash: 10000, dailyPnl: 0, positions: {} };
  assert.equal(risk.approveOrder(account, { market: "US", symbol: "AAPL", side: "hold", qty: 1, price: 100 }).code, "INVALID_SIDE");
  assert.equal(risk.approveOrder(account, { market: "US", symbol: "AAPL", side: "buy", qty: 0, price: 100 }).code, "INVALID_QTY");
  assert.equal(risk.approveOrder(account, { market: "US", symbol: "AAPL", side: "buy", qty: 1.5, price: 100 }).code, "INVALID_QTY");
  assert.equal(risk.approveOrder(account, { market: "US", symbol: "AAPL", side: "buy", qty: 1, price: 0 }).code, "INVALID_PRICE");
  assert.equal(risk.approveOrder(account, { market: "US", symbol: "bad symbol", side: "buy", qty: 1, price: 100 }).code, "INVALID_SYMBOL");
});
