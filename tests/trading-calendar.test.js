import assert from "node:assert/strict";
import test from "node:test";
import { SimplifiedWeekdayCalendar } from "../js/trading-calendar.js";

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
