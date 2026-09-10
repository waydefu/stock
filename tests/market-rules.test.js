import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultLotForMarket,
  getMarketRules,
  validateQuantity,
  getTickSize,
  validateTick,
  calculatePriceLimits,
  validatePriceLimit,
  getCurrentSession,
  validateOrderTypeInSession,
} from "../js/market-rules.js";

test("TW market rules expose sourced regular and odd-lot boundaries", () => {
  const rules = getMarketRules("TW");
  assert.equal(rules.currency, "TWD");
  assert.equal(rules.regularUnit, 1000);
  assert.deepEqual(rules.oddLot, { min: 1, max: 999, orderType: "limit", timeInForce: "DAY" });
  assert.equal(rules.dailyPriceLimitPct, 10);
  assert.equal(validateQuantity("TW", 2000, "regular").ok, true);
  assert.equal(validateQuantity("TW", 999, "regular").ok, false);
  assert.equal(validateQuantity("TW", 999, "oddLot").ok, true);
  assert.equal(defaultLotForMarket("TW"), "oddLot");
  assert.equal(defaultLotForMarket("US"), "regular");
  assert.equal(validateQuantity("TW", 1).ok, true);
  assert.equal(validateQuantity("TW", 1000).ok, false);
});

test("US market rules remain explicitly simplified until an official venue adapter exists", () => {
  const rules = getMarketRules("US");
  assert.equal(rules.currency, "USD");
  assert.equal(rules.mode, "simplified-prototype");
  assert.equal(validateQuantity("US", 1, "regular").ok, true);
  assert.equal(validateQuantity("US", 0, "regular").ok, false);
});

test("TW tick size schedule matches TWSE 營業細則第62條", () => {
  // Test each price band: 0-10: 0.01, 10-50: 0.05, 50-100: 0.10, 100-500: 0.50, 500-1000: 1.00, >=1000: 5.00
  assert.equal(getTickSize("TW", 5), 0.01);      // < 10
  assert.equal(getTickSize("TW", 9.99), 0.01);
  assert.equal(getTickSize("TW", 10), 0.05);     // 10-50
  assert.equal(getTickSize("TW", 30), 0.05);
  assert.equal(getTickSize("TW", 49.99), 0.05);
  assert.equal(getTickSize("TW", 50), 0.10);     // 50-100
  assert.equal(getTickSize("TW", 99), 0.10);
  assert.equal(getTickSize("TW", 100), 0.50);    // 100-500
  assert.equal(getTickSize("TW", 149.5), 0.50);  // boundary at 150
  assert.equal(getTickSize("TW", 150), 0.50);    // 150 is in 100-500 band
  assert.equal(getTickSize("TW", 499.5), 0.50);  // boundary at 500
  assert.equal(getTickSize("TW", 500), 1.00);    // 500-1000
  assert.equal(getTickSize("TW", 999), 1.00);
  assert.equal(getTickSize("TW", 1000), 5.00);   // >= 1000
  assert.equal(getTickSize("TW", 5000), 5.00);
  // US has no tick schedule
  assert.equal(getTickSize("US", 100), null);
});

test("validateTick rejects prices not on tick grid", () => {
  // Valid prices
  assert.deepEqual(validateTick("TW", 10.05), { ok: true, code: "VALID" });
  assert.deepEqual(validateTick("TW", 50.10), { ok: true, code: "VALID" });
  assert.deepEqual(validateTick("TW", 100.50), { ok: true, code: "VALID" });
  assert.deepEqual(validateTick("TW", 150), { ok: true, code: "VALID" });
  assert.deepEqual(validateTick("TW", 500), { ok: true, code: "VALID" });
  assert.deepEqual(validateTick("TW", 1000), { ok: true, code: "VALID" });

  // Invalid prices - not on tick
  const r1 = validateTick("TW", 10.03); // tick is 0.05, 10.03 is not multiple
  assert.equal(r1.ok, false);
  assert.equal(r1.code, "INVALID_TICK");
  assert.ok(r1.reason.includes("10.03"));

  const r2 = validateTick("TW", 50.07); // tick is 0.10
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "INVALID_TICK");

  const r3 = validateTick("TW", 100.33); // tick is 0.50
  assert.equal(r3.ok, false);
  assert.equal(r3.code, "INVALID_TICK");

  // US - no tick rule
  const usResult = validateTick("US", 100.123);
  assert.equal(usResult.ok, true);
  assert.equal(usResult.code, "NO_TICK_RULE");
  assert.ok(usResult.reason.includes("略過驗證"));
});

test("calculatePriceLimits computes limit up/down with tick rounding", () => {
  // Reference price 40.60 (from TWSE example)
  const limits = calculatePriceLimits("TW", 40.60);
  assert.ok(limits);
  // 40.60 * 1.1 = 44.66, tick at 40-50 is 0.05, floor to 44.65
  assert.equal(limits.limitUp, 44.65);
  // 40.60 * 0.9 = 36.54, tick at 30-50 is 0.05, ceil to 36.55
  assert.equal(limits.limitDown, 36.55);

  // Reference price 100 (tick 0.50)
  const limits2 = calculatePriceLimits("TW", 100);
  assert.ok(limits2);
  // 110, tick 0.50, floor = 110
  assert.equal(limits2.limitUp, 110);
  // 90, tick 0.50, ceil = 90
  assert.equal(limits2.limitDown, 90);

  // Reference price 500 (tick 5.00)
  const limits3 = calculatePriceLimits("TW", 500);
  assert.ok(limits3);
  // 550, tick 5.00, floor = 550
  assert.equal(limits3.limitUp, 550);
  // 450, tick 5.00, ceil = 450
  assert.equal(limits3.limitDown, 450);

  // US - no price limit
  assert.equal(calculatePriceLimits("US", 100), null);
});

test("validatePriceLimit enforces daily price limits", () => {
  // Reference 40.60, limits: up=44.65, down=36.55
  assert.deepEqual(validatePriceLimit("TW", 44.65, 40.60), { ok: true, code: "VALID" });
  assert.deepEqual(validatePriceLimit("TW", 36.55, 40.60), { ok: true, code: "VALID" });
  assert.deepEqual(validatePriceLimit("TW", 40.60, 40.60), { ok: true, code: "VALID" });

  // Above limit up
  const r1 = validatePriceLimit("TW", 44.66, 40.60);
  assert.equal(r1.ok, false);
  assert.equal(r1.code, "PRICE_LIMIT_UP");
  assert.equal(r1.limitUp, 44.65);

  // Below limit down
  const r2 = validatePriceLimit("TW", 36.54, 40.60);
  assert.equal(r2.ok, false);
  assert.equal(r2.code, "PRICE_LIMIT_DOWN");
  assert.equal(r2.limitDown, 36.55);

  // US - no price limit
  const usResult = validatePriceLimit("US", 200, 100);
  assert.equal(usResult.ok, true);
  assert.equal(usResult.code, "NO_PRICE_LIMIT");
  assert.ok(usResult.reason.includes("略過驗證"));
});

test("getCurrentSession returns correct session for TW market", () => {
  // Use a fixed date in Asia/Taipei timezone (UTC+8)
  // 2025-01-06 is a Monday
  // 2025-01-06T00:00:00.000Z = 2025-01-06 08:00 Taipei time (before market)
  // 2025-01-06T00:30:00.000Z = 2025-01-06 08:30 Taipei time (pre-market call auction)
  // 2025-01-06T01:00:00.000Z = 2025-01-06 09:00 Taipei time (regular session)
  // 2025-01-06T05:25:00.000Z = 2025-01-06 13:25 Taipei time (pre-close call auction)
  // 2025-01-06T05:30:00.000Z = 2025-01-06 13:30 Taipei time (after market)
  // 2025-01-11T01:00:00.000Z = 2025-01-11 09:00 Taipei time (Saturday)
  const monday0800 = new Date("2025-01-06T00:00:00.000Z").getTime();
  const monday0830 = new Date("2025-01-06T00:30:00.000Z").getTime();
  const monday0900 = new Date("2025-01-06T01:00:00.000Z").getTime();
  const monday1325 = new Date("2025-01-06T05:25:00.000Z").getTime();
  const monday1330 = new Date("2025-01-06T05:30:00.000Z").getTime();
  const saturday0900 = new Date("2025-01-11T01:00:00.000Z").getTime(); // Saturday 09:00 Taipei

  // Before market hours (08:00) - should be null
  const preMarket = getCurrentSession("TW", monday0800);
  assert.equal(preMarket, null);

  // Pre-market call auction 08:30-09:00
  const callAuction = getCurrentSession("TW", monday0830);
  assert.ok(callAuction);
  assert.equal(callAuction.name, "preMarket");
  assert.equal(callAuction.type, "callAuction");
  assert.deepEqual(callAuction.orderTypes, ["limit"]);

  // Regular continuous 09:00-13:25
  const regular = getCurrentSession("TW", monday0900);
  assert.ok(regular);
  assert.equal(regular.name, "regular");
  assert.equal(regular.type, "continuous");
  assert.deepEqual(regular.orderTypes, ["limit", "market"]);

  // Pre-close call auction 13:25-13:30
  const preClose = getCurrentSession("TW", monday1325);
  assert.ok(preClose);
  assert.equal(preClose.name, "preClose");
  assert.equal(preClose.type, "callAuction");
  assert.deepEqual(preClose.orderTypes, ["limit"]);

  // After market close (13:30)
  const afterHours = getCurrentSession("TW", monday1330);
  assert.equal(afterHours, null);

  // Weekend
  const saturday = getCurrentSession("TW", saturday0900);
  assert.equal(saturday, null);

  // US - no sessions defined
  assert.equal(getCurrentSession("US", Date.now()), null);
});

test("validateOrderTypeInSession enforces order types per session", () => {
  const monday0800 = new Date("2025-01-06T00:00:00.000Z").getTime(); // Monday 08:00 Taipei
  const monday0830 = new Date("2025-01-06T00:30:00.000Z").getTime(); // Monday 08:30 Taipei
  const monday0900 = new Date("2025-01-06T01:00:00.000Z").getTime(); // Monday 09:00 Taipei
  const monday1325 = new Date("2025-01-06T05:25:00.000Z").getTime(); // Monday 13:25 Taipei

  // Pre-market: only limit
  const preMarketLimit = validateOrderTypeInSession("TW", "limit", monday0830);
  assert.equal(preMarketLimit.ok, true);

  const preMarketMarket = validateOrderTypeInSession("TW", "market", monday0830);
  assert.equal(preMarketMarket.ok, false);
  assert.equal(preMarketMarket.code, "ORDER_TYPE_NOT_ALLOWED");

  // Regular: limit and market allowed
  const regularLimit = validateOrderTypeInSession("TW", "limit", monday0900);
  assert.equal(regularLimit.ok, true);

  const regularMarket = validateOrderTypeInSession("TW", "market", monday0900);
  assert.equal(regularMarket.ok, true);

  // Pre-close: only limit
  const preCloseLimit = validateOrderTypeInSession("TW", "limit", monday1325);
  assert.equal(preCloseLimit.ok, true);

  const preCloseMarket = validateOrderTypeInSession("TW", "market", monday1325);
  assert.equal(preCloseMarket.ok, false);
  assert.equal(preCloseMarket.code, "ORDER_TYPE_NOT_ALLOWED");

  // Outside trading hours
  const outside = validateOrderTypeInSession("TW", "limit", monday0800);
  assert.equal(outside.ok, false);
  assert.equal(outside.code, "OUTSIDE_TRADING_HOURS");

  // US - no sessions
  const us = validateOrderTypeInSession("US", "limit", Date.now());
  assert.equal(us.ok, false);
  assert.equal(us.code, "OUTSIDE_TRADING_HOURS");
});