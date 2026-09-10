import assert from "node:assert/strict";
import test from "node:test";
import { avgLast, fmtDay, money, orderEstimate, pct, signed, statePanel, stateRow, symbolLabel, tone } from "../js/view.js";

test("tone maps sign to semantic classes", () => {
  assert.equal(tone(1.5), "up");
  assert.equal(tone(-0.1), "down");
  assert.equal(tone(0), "neutral");
});

test("money and signed formatters keep numeric output", () => {
  assert.equal(money(1234.5, "TWD"), "TWD 1,234.50");
  assert.equal(signed(-3.14159), "-3.14");
  assert.equal(pct(2), "+2.00%");
});

test("symbolLabel falls back to the raw code for unknown symbols", () => {
  assert.equal(symbolLabel("2330"), "2330 台積電");
  assert.equal(symbolLabel("NOPE"), "NOPE");
});

test("statePanel escapes markup and uses alert only for errors", () => {
  const error = statePanel("error", "<b>x</b>", "a&b");
  assert.ok(error.includes('role="alert"'));
  assert.ok(!error.includes("<b>x</b>"));
  assert.ok(error.includes("&lt;b&gt;x&lt;/b&gt;"));
  const empty = statePanel("empty", "t", "d");
  assert.ok(empty.includes('role="status"'));
  assert.ok(statePanel("bogus-kind", "t", "d").includes("state-empty"));
});

test("stateRow spans the given columns", () => {
  const row = stateRow(7, "empty", "t", "d");
  assert.ok(row.includes('colspan="7"'));
  assert.ok(row.includes("state-empty"));
});

test("avgLast and fmtDay handle short series", () => {
  assert.equal(avgLast([1, 2, 3], 5), 2);
  assert.match(fmtDay(Date.UTC(2025, 0, 2)), /\d+\/\d+/);
});

test("orderEstimate is advisory-only math with invalid-input guard", () => {
  assert.deepEqual(orderEstimate({ qty: 10, price: 100, equity: 1_000_000 }), { notional: 1000, equityPct: 0.1, estFee: 1.425 });
  assert.equal(orderEstimate({ qty: 0, price: 100, equity: 1_000_000 }), null);
  assert.equal(orderEstimate({ qty: 1.5, price: 100, equity: 1_000_000 }), null);
  assert.equal(orderEstimate({ qty: 10, price: -5, equity: 1_000_000 }), null);
  assert.equal(orderEstimate({ qty: 10, price: 100, equity: 0 }), null);
});
