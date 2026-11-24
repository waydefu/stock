import assert from "node:assert/strict";
import test from "node:test";
import { drawCandles, drawLine, candleHoverAt } from "../js/charts.js";
import { getBars } from "../js/data.js";

function stubCanvas() {
  const calls = [];
  const ctx = new Proxy({}, {
    get: (target, prop) => {
      if (prop === "canvas") return canvas;
      return (...args) => { calls.push([prop, ...args]); };
    },
    set: (target, prop, value) => { calls.push([`set:${prop}`, value]); return true; },
  });
  const canvas = {
    clientWidth: 720,
    clientHeight: 220,
    width: 0,
    height: 0,
    style: {},
    getBoundingClientRect: () => ({ width: 720 }),
    getContext: () => ctx,
  };
  return { canvas, calls };
}

test("candle chart draws a dashed last-price line with the close label", () => {
  const { canvas, calls } = stubCanvas();
  const bars = getBars("2330");
  drawCandles(canvas, bars);
  const dashes = calls.filter(([name]) => name === "setLineDash").map(([, pattern]) => pattern);
  assert.deepEqual(dashes[0], [4, 3]);
  assert.deepEqual(dashes.at(-1), []);
  const lastClose = bars.at(-1).c.toFixed(2);
  const labels = calls.filter(([name]) => name === "fillText").map(([, text]) => text);
  assert.ok(labels.includes(lastClose), `expected last-close label ${lastClose}`);
});

test("drawLine tolerates empty input and draws non-empty series", () => {
  const empty = stubCanvas();
  drawLine(empty.canvas, []);
  assert.equal(empty.calls.length, 0);
  const { canvas, calls } = stubCanvas();
  drawLine(canvas, [1, 2, 3]);
  assert.ok(calls.some(([name]) => name === "stroke"));
});

test("drawLine marks the IS/OOS boundary only when the split is interior", () => {
  const { canvas, calls } = stubCanvas();
  drawLine(canvas, [1, 2, 3, 4, 5, 6], { oosStart: 4 });
  const labels = calls.filter(([name]) => name === "fillText").map(([, text]) => text);
  assert.ok(labels.includes("IS") && labels.includes("OOS"));
  const plain = stubCanvas();
  drawLine(plain.canvas, [1, 2, 3], { oosStart: 0 });
  const plainLabels = plain.calls.filter(([name]) => name === "fillText").map(([, text]) => text);
  assert.ok(!plainLabels.includes("OOS"));
});

test("candleHoverAt maps pointer x to the nearest bar index", () => {
  const bars = getBars("2330").slice(-90);
  const width = 720;
  const xStep = (width - 52) / bars.length;
  const hit = candleHoverAt(bars, width, 42 + xStep * 3 + xStep / 2, { window: 90 });
  assert.ok(hit);
  assert.equal(hit.index, 3);
  assert.equal(hit.bar.c, bars[3].c);
  assert.equal(candleHoverAt(bars, width, 0, { window: 90 }), null);
  assert.equal(candleHoverAt([], width, 100), null);
});

test("candle chart draws crosshair and OHLC tooltip for hover index", () => {
  const { canvas, calls } = stubCanvas();
  const bars = getBars("2330");
  drawCandles(canvas, bars, { hover: 5 });
  const dashes = calls.filter(([name]) => name === "setLineDash").map(([, pattern]) => pattern);
  assert.ok(dashes.some((pattern) => pattern.length === 2 && pattern[0] === 3), "expected crosshair dash pattern");
  const labels = calls.filter(([name]) => name === "fillText").map(([, text]) => String(text));
  const bar = bars.slice(-90)[5];
  assert.ok(labels.some((label) => label.includes(`O ${bar.o.toFixed(2)}`) && label.includes(`H ${bar.h.toFixed(2)}`)), "expected OHLC tooltip line 1");
  assert.ok(labels.some((label) => label.includes(`L ${bar.l.toFixed(2)}`) && label.includes(`C ${bar.c.toFixed(2)}`)), "expected OHLC tooltip line 2");
});
