import assert from "node:assert/strict";
import test from "node:test";
import { MarketHolidayCalendar, SimplifiedWeekdayCalendar, TW_MARKET_HOLIDAYS } from "../js/trading-calendar.js";

test("simplified calendar uses market-local weekday and states its limitation", () => {
  const calendar = new SimplifiedWeekdayCalendar();
  assert.equal(calendar.mode, "SIMPLIFIED_WEEKDAY");
  assert.equal(calendar.isTradingDay("TW", "2025-01-03T01:00:00.000Z"), true);
  assert.equal(calendar.isTradingDay("US", "2025-01-05T01:00:00.000Z"), false);
  assert.equal(calendar.policy("US").holidaySupport, "none");
});

test("calendar rejects unsupported markets", () => {
  const calendar = new SimplifiedWeekdayCalendar();
  assert.throws(() => calendar.isTradingDay("EU", "2025-01-01T00:00:00.000Z"), /unsupported market/i);
});

test("TW 官方休市日不是交易日，平日是", () => {
  const calendar = new MarketHolidayCalendar();
  // 2026-10-09 週五：國慶日補假（TWSE 官方市場開休市日期）
  assert.equal(calendar.isTradingDay("TW", Date.parse("2026-10-09T01:00:00Z")), false);
  assert.equal(calendar.holidayFor("TW", Date.parse("2026-10-09T01:00:00Z")), "國慶日（補假）");
  // 2026-02-17 週二：春節休市
  assert.equal(calendar.isTradingDay("TW", Date.parse("2026-02-17T01:00:00Z")), false);
  // 2026-09-15 週二：一般交易日
  assert.equal(calendar.isTradingDay("TW", Date.parse("2026-09-15T01:00:00Z")), true);
  assert.equal(calendar.holidayFor("TW", Date.parse("2026-09-15T01:00:00Z")), null);
});

test("休市日政策與涵蓋範圍是誠實的（超出範圍退回 weekday 規則）", () => {
  const calendar = new MarketHolidayCalendar();
  const policy = calendar.policy("TW");
  assert.equal(policy.holidaySupport, "sourced-snapshot");
  assert.match(policy.holidaySource, /twse\.com\.tw/);
  assert.equal(policy.holidayCoverage, "2026-01-01..2026-12-31");
  assert.equal(policy.holidayAccessed, "2026-10-22");
  assert.equal(calendar.policy("US").holidaySupport, "none", "US 交易所日曆仍未建模，不假裝有");
  assert.equal(calendar.covers("TW", Date.parse("2026-06-02T01:00:00Z")), true);
  assert.equal(calendar.covers("TW", Date.parse("2025-06-02T01:00:00Z")), false);
});

test("休市日快照本身是固定、可稽核的資料", () => {
  assert.equal(TW_MARKET_HOLIDAYS.effectiveFrom, "2026-01-01");
  assert.equal(TW_MARKET_HOLIDAYS.effectiveTo, "2026-12-31");
  assert.equal(Object.keys(TW_MARKET_HOLIDAYS.days).length, 24);
  assert.ok(Object.values(TW_MARKET_HOLIDAYS.days).every((name) => typeof name === "string" && name.length > 0));
});
