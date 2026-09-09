import assert from "node:assert/strict";
import test from "node:test";
import { getMarketRules, validateQuantity } from "../js/market-rules.js";

test("TW market rules expose sourced regular and odd-lot boundaries", () => {
  const rules = getMarketRules("TW");
  assert.equal(rules.currency, "TWD");
  assert.equal(rules.regularUnit, 1000);
  assert.deepEqual(rules.oddLot, { min: 1, max: 999, orderType: "limit", timeInForce: "DAY" });
  assert.equal(rules.dailyPriceLimitPct, 10);
  assert.equal(validateQuantity("TW", 2000, "regular").ok, true);
  assert.equal(validateQuantity("TW", 999, "regular").ok, false);
  assert.equal(validateQuantity("TW", 999, "oddLot").ok, true);
  assert.equal(validateQuantity("TW", 1000, "oddLot").ok, false);
});

test("US market rules remain explicitly simplified until an official venue adapter exists", () => {
  const rules = getMarketRules("US");
  assert.equal(rules.currency, "USD");
  assert.equal(rules.mode, "simplified-prototype");
  assert.equal(validateQuantity("US", 1, "regular").ok, true);
  assert.equal(validateQuantity("US", 0, "regular").ok, false);
});
