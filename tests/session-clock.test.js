import assert from "node:assert/strict";
import test from "node:test";
import { MarketSessionClock } from "../js/session-clock.js";

test("session clock uses market-local timezone instead of UTC date", () => {
  const clock = new MarketSessionClock();
  const instant = "2025-01-03T01:00:00.000Z";
  assert.equal(clock.sessionKey("TW", instant), "2025-01-03");
  assert.equal(clock.sessionKey("US", instant), "2025-01-02");
  assert.equal(clock.policy("TW").calendar, "simplified-weekday");
  assert.equal(clock.policy("US").timezone, "America/New_York");
});

test("session clock rejects unsupported markets and invalid timestamps", () => {
  const clock = new MarketSessionClock();
  assert.throws(() => clock.sessionKey("EU", "2025-01-01T00:00:00.000Z"), /unsupported market/i);
  assert.throws(() => clock.sessionKey("TW", "not-a-date"), /invalid timestamp/i);
});
