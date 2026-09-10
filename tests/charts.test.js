import assert from "node:assert/strict";
import test from "node:test";
import { drawCandles, drawLine } from "../js/charts.js";
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
