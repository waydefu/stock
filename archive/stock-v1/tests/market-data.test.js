import assert from "node:assert/strict";
import test from "node:test";
import { getBars, quote } from "../js/data.js";
import { SimulatedAdapter } from "../js/market-data.js";

test("simulated adapter returns the same bars and quotes as the generator", () => {
  const adapter = new SimulatedAdapter();
  assert.deepEqual(adapter.getBars("2330"), getBars("2330"));
  assert.deepEqual(adapter.quote("AAPL"), quote("AAPL"));
});

test("simulated adapter declares an honest simulation source", () => {
  const source = new SimulatedAdapter().getSource();
  assert.equal(source.kind, "simulation");
  assert.match(source.shortLabel, /模擬/);
  assert.ok(typeof source.note === "string" && source.note.length > 0);
});

test("simulated adapter rejects unknown symbols with a stable code", () => {
  const adapter = new SimulatedAdapter();
  assert.throws(() => adapter.getBars("NOPE"), (error) => error.code === "INVALID_SYMBOL");
  assert.throws(() => adapter.quote("NOPE"), (error) => error.code === "INVALID_SYMBOL");
});
