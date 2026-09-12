/* Global search acceptance: any TW code resolves, never silently no-ops,
   simulation never dials out, remote symbols never pollute local SYMBOLS. */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SEARCH_ACTIONS,
  describeSearchAction,
  normalizeSearchQuery,
  resolveSearchQuery,
  validateRemoteSymbol,
} from "../js/symbol-search.js";
import { SYMBOLS } from "../js/data.js";

const LOCAL = [
  { code: "2330", name: "台積電" },
  { code: "2317", name: "鴻海" },
];
const localFind = (query, original) => {
  const hit = LOCAL.find((i) => i.code.toLowerCase() === query)
    ?? LOCAL.find((i) => i.code.toLowerCase().startsWith(query))
    ?? LOCAL.find((i) => i.name.includes(original.trim()));
  return hit ? hit.code : null;
};

test("local exact code resolves", () => {
  assert.deepEqual(resolveSearchQuery("2330", { localFind, dataMode: "simulation" }), { action: "open-local", code: "2330" });
});

test("local prefix behavior preserved", () => {
  assert.deepEqual(resolveSearchQuery("233", { localFind, dataMode: "simulation" }), { action: "open-local", code: "2330" });
});

test("local Chinese name resolves", () => {
  assert.deepEqual(resolveSearchQuery("鴻海", { localFind, dataMode: "simulation" }), { action: "open-local", code: "2317" });
});

test("unknown symbol in simulation gives explicit needs-fugle, no fetch", () => {
  let called = 0;
  const d = resolveSearchQuery("0050", { localFind, dataMode: "simulation" });
  assert.deepEqual(d, { action: "needs-fugle-mode", code: "0050" });
  assert.equal(called, 0);
  const text = describeSearchAction(d).text;
  assert.ok(text.includes("0050") && text.includes("Fugle") && text.includes("不會自動切換"));
});

test("unknown symbol in Fugle mode goes remote", () => {
  assert.deepEqual(
    resolveSearchQuery(" 0050 ", { localFind, dataMode: "fugle-proxy" }),
    { action: "validate-remote", code: "0050" },
  );
});

test("valid remote symbol succeeds with provenance guard", async () => {
  const r = await validateRemoteSymbol("0050", {
    quoteFn: async (code) => ({ data: { symbol: code, price: 100 }, meta: { provider: "FUGLE" } }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.symbol, "0050");
});

test("non-FUGLE provenance rejected (no mixed source)", async () => {
  const r = await validateRemoteSymbol("0050", {
    quoteFn: async () => ({ data: { symbol: "0050" }, meta: { provider: "FAKE" } }),
  });
  assert.deepEqual([r.ok, r.code], [false, "DATA_INVALID"]);
});

test("invalid remote symbol returns INVALID_SYMBOL explicitly", async () => {
  const err = Object.assign(new Error("查無"), { code: "INVALID_SYMBOL" });
  const r = await validateRemoteSymbol("9999", { quoteFn: async () => { throw err; } });
  assert.deepEqual([r.ok, r.code], [false, "INVALID_SYMBOL"]);
});

test("provider timeout gives explicit error, never silent", async () => {
  const err = Object.assign(new Error("timeout"), { code: "TIMEOUT" });
  const r = await validateRemoteSymbol("0050", { quoteFn: async () => { throw err; } });
  assert.deepEqual([r.ok, r.code], [false, "TIMEOUT"]);
  assert.ok(r.message.length > 0);
});

test("missing quoteFn is explicit, not a crash", async () => {
  const r = await validateRemoteSymbol("0050", {});
  assert.equal(r.ok, false);
});

test("empty and whitespace queries are no-op", () => {
  assert.deepEqual(resolveSearchQuery("", { localFind }), { action: "noop" });
  assert.deepEqual(resolveSearchQuery("   ", { localFind }), { action: "noop" });
  assert.equal(normalizeSearchQuery(null), "");
});

test("free text with no hit is not-found, not remote", () => {
  const d = resolveSearchQuery("不存在的公司", { localFind, dataMode: "fugle-proxy" });
  assert.equal(d.action, "not-found");
  assert.ok(describeSearchAction(d).text.includes("查無標的"));
});

test("resolver never mutates simulation SYMBOLS", () => {
  const before = SYMBOLS.map((s) => s.code).join(",");
  resolveSearchQuery("0050", { localFind, dataMode: "fugle-proxy" });
  assert.equal(SYMBOLS.map((s) => s.code).join(","), before);
  assert.ok(!SYMBOLS.some((s) => s.code === "0050"));
});

test("every non-noop decision has display text", () => {
  for (const d of [
    { action: "open-local", code: "2330" },
    { action: "needs-fugle-mode", code: "0050" },
    { action: "validate-remote", code: "0050" },
    { action: "not-found", query: "xyz" },
  ]) {
    assert.ok(typeof describeSearchAction(d).text === "string");
  }
  assert.equal(describeSearchAction({ action: "noop" }).kind, "none");
});
