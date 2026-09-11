import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { DATA_ERROR_CODE, normalizeQuote } from "../js/market-data-contract.js";
import { mapFugleBars, mapFugleQuote, mapFugleTimestamp } from "../js/providers/fugle-mapper.js";

const quoteFixture = JSON.parse(readFileSync(new URL("./fixtures/fugle/quote-success.json", import.meta.url)));
const barsFixture = JSON.parse(readFileSync(new URL("./fixtures/fugle/historical-success.json", import.meta.url)));

test("official quote fixture maps to the normalized contract", () => {
  const mapped = mapFugleQuote(quoteFixture);
  const q = normalizeQuote(mapped, { market: mapped.market });
  assert.equal(q.symbol, "2330");
  assert.equal(q.market, "TW");
  assert.equal(q.price, 568);
  assert.equal(q.previousClose, 566);
  assert.equal(q.change, 2);
  assert.equal(q.changePct, 0.35);
  assert.equal(q.volume, 54538);
  assert.equal(q.timestamp, 1685338200000);
});

test("timestamp conversion is sourced microseconds-to-milliseconds", () => {
  assert.equal(mapFugleTimestamp(1685338200000000), 1685338200000);
  assert.equal(mapFugleTimestamp(null), null);
  assert.equal(mapFugleTimestamp("nope"), null);
});

test("unknown quote fields stay null, missing price is fatal", () => {
  const { total, ...rest } = quoteFixture;
  assert.equal(normalizeQuote(mapFugleQuote(rest), { market: "TW" }).volume, null);
  assert.throws(() => mapFugleQuote({ ...quoteFixture, lastPrice: undefined }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
  assert.throws(() => mapFugleQuote(null), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
});

test("official bars fixture maps to ascending millisecond bars", () => {
  const { bars, adjusted } = mapFugleBars(barsFixture);
  assert.equal(adjusted, null);
  assert.deepEqual(bars.map((b) => b.c), [119.0, 119.0, 120.85]);
  assert.deepEqual(bars.map((b) => b.v), [8123456, 7654321, 9239321]);
  assert.ok(bars[0].t < bars[1].t && bars[1].t < bars[2].t);
  assert.equal(bars[2].t, Date.parse("2023-02-08T00:00:00+08:00"));
  assert.throws(() => mapFugleBars({ ...barsFixture, data: [...barsFixture.data, barsFixture.data[barsFixture.data.length - 1]] }), (e) => e.code === DATA_ERROR_CODE.DATA_DUPLICATE);
  assert.throws(() => mapFugleBars({ ...barsFixture, data: [...barsFixture.data].reverse() }), (e) => e.code === DATA_ERROR_CODE.DATA_OUT_OF_ORDER);
  assert.throws(() => mapFugleBars({ foo: 1 }), (e) => e.code === DATA_ERROR_CODE.DATA_INVALID);
});
