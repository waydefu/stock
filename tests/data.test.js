import assert from "node:assert/strict";
import test from "node:test";
import {
  SYMBOLS,
  closes,
  getBars,
  getSymbol,
  mulberry32,
  quote,
  rollingHigh,
  rsi,
  seedFromString,
  sma,
  volumeRatio,
} from "../js/data.js";

test("seeded generator is deterministic and bounded", () => {
  const a = mulberry32(seedFromString("AAPL"));
  const b = mulberry32(seedFromString("AAPL"));
  const firstA = Array.from({ length: 8 }, () => a());
  const firstB = Array.from({ length: 8 }, () => b());
  assert.deepEqual(firstA, firstB);
  assert.ok(firstA.every((value) => value >= 0 && value < 1));
  assert.notEqual(seedFromString("AAPL"), seedFromString("NVDA"));
});

test("all listed symbols have valid reproducible OHLCV bars", () => {
  for (const meta of SYMBOLS) {
    const first = getBars(meta.code);
    const second = getBars(meta.code);
    assert.deepEqual(first, second);
    assert.equal(first.length, 250);
    assert.ok(first.every((bar, i) => {
      const next = first[i + 1];
      return bar.l <= bar.o && bar.l <= bar.c && bar.h >= bar.o && bar.h >= bar.c &&
        bar.v > 0 && (!next || next.t > bar.t);
    }));
  }
});

test("quote exposes the last close and percentage movement", () => {
  const q = quote("2330");
  const bars = getBars("2330");
  assert.equal(q.price, bars.at(-1).c);
  assert.equal(q.prev, bars.at(-2).c);
  assert.equal(q.code, "2330");
  assert.ok(Number.isFinite(q.pct));
});

test("SMA leaves insufficient history empty and averages the window", () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test("RSI does not emit values before its warm-up window", () => {
  const values = [1, 2, 3, 4, 5, 6, 7];
  const result = rsi(values, 3);
  assert.deepEqual(result.slice(0, 3), [null, null, null]);
  assert.equal(result[3], 100);
});

test("rolling high excludes the current bar to prevent look-ahead", () => {
  assert.deepEqual(rollingHigh([1, 3, 2, 5, 4], 2), [null, null, 3, 3, 5]);
});

test("market metadata and derived volume ratio are available", () => {
  assert.equal(getSymbol("2330").name, "台積電");
  assert.equal(getSymbol("AAPL").ccy, "USD");
  assert.ok(volumeRatio("AAPL") > 0);
  assert.equal(closes("NVDA").length, 250);
});
