import assert from "node:assert/strict";
import test from "node:test";
import { fugleResearchRange } from "../js/research-range.js";
import { isLessThanOneCalendarYear } from "../js/market-data-contract.js";

test("research range helper always stays inside one calendar year", () => {
  const { from, to } = fugleResearchRange({ to: "2026-09-11", lookbackDays: 350 });
  assert.ok(from < to);
  assert.ok(isLessThanOneCalendarYear(from, to));
  assert.equal(to, "2026-09-11");
});

test("generated range passes the exchange rule across two years of end dates", () => {
  const start = Date.UTC(2024, 0, 1);
  for (let d = 0; d < 800; d++) {
    const to = new Date(start + d * 86_400_000).toISOString().slice(0, 10);
    const { from, to: out } = fugleResearchRange({ to, lookbackDays: 350 });
    assert.equal(out, to);
    assert.ok(isLessThanOneCalendarYear(from, out), `${from}~${out} must be inside one year`);
  }
});

test("exactly-one-year spans are rejected even at 365 days", () => {
  assert.equal(isLessThanOneCalendarYear("2025-01-01", "2026-01-01"), false);
});
