/* Canvas 圖表：不依賴外部套件，所有數值先由資料層算好再繪製。 */
"use strict";

import { sma, fmtDate } from "./data.js";

const COLORS = { grid: "#252a38", text: "#9497a9", candleUp: "#22b07d", candleDown: "#f6465d", fast: "#855bfb", slow: "#4da3ff", volume: "#3b4154" };

function prepare(canvas, fallbackHeight = 220) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width || canvas.clientWidth || 720));
  // 高度以 CSS 為準（canvas.chart 定高），JS 不再寫 inline 高度覆蓋它；
  // 隱藏面板量不到時用 fallback，繪製仍以傳入座標空間為準。
  const height = Math.max(120, Math.floor(canvas.clientHeight || fallbackHeight));
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0a0b10";
  ctx.fillRect(0, 0, width, height);
  return { ctx, width, height };
}

function line(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

function text(ctx, value, x, y, color = COLORS.text, align = "left") {
  ctx.fillStyle = color; ctx.font = "11px ui-monospace, monospace"; ctx.textAlign = align; ctx.fillText(value, x, y);
}

function chartBounds(values, top = 18, bottom = 42, height = 300) {
  const clean = values.filter((v) => Number.isFinite(v));
  const min = Math.min(...clean), max = Math.max(...clean);
  const pad = (max - min || max * 0.02 || 1) * 0.08;
  return { min: min - pad, max: max + pad, top, bottom, plotHeight: height - top - bottom };
}

export function drawCandles(canvas, bars, { fast = 20, slow = 50, window = 90, hover = null } = {}) {
  if (!canvas || !bars?.length) return;
  const { ctx, width, height } = prepare(canvas);
  const data = bars.slice(-window);
  const closes = bars.map((b) => b.c);
  const fastValues = sma(closes, fast).slice(-window);
  const slowValues = sma(closes, slow).slice(-window);
  const values = data.flatMap((bar, i) => [bar.h, bar.l, fastValues[i], slowValues[i]]).filter(Number.isFinite);
  const bounds = chartBounds(values, 18, 42, height - 58);
  const plotBottom = height - 42;
  const candleAreaBottom = height - 72;
  const maxVolume = Math.max(...data.map((b) => b.v));
  const xStep = (width - 52) / data.length;
  const xAt = (i) => 42 + i * xStep + xStep / 2;
  const yAt = (v) => bounds.top + (bounds.max - v) / (bounds.max - bounds.min) * (candleAreaBottom - bounds.top);

  for (let i = 0; i <= 4; i++) {
    const y = bounds.top + i * (candleAreaBottom - bounds.top) / 4;
    line(ctx, 40, y, width - 8, y, COLORS.grid);
    const value = bounds.max - i * (bounds.max - bounds.min) / 4;
    text(ctx, value.toFixed(2), 36, y + 4, COLORS.text, "right");
  }
  for (let i = 0; i < data.length; i += Math.max(1, Math.floor(data.length / 5))) {
    text(ctx, fmtDate(data[i].t).slice(5), xAt(i), plotBottom + 18, COLORS.text, "center");
  }

  for (let i = 0; i < data.length; i++) {
    const bar = data[i], x = xAt(i), up = bar.c >= bar.o;
    const color = up ? COLORS.candleUp : COLORS.candleDown;
    const top = yAt(Math.max(bar.o, bar.c)), bodyBottom = yAt(Math.min(bar.o, bar.c));
    line(ctx, x, yAt(bar.h), x, yAt(bar.l), color, 1);
    ctx.fillStyle = color;
    ctx.fillRect(x - Math.max(1, xStep * 0.29), top, Math.max(2, xStep * 0.58), Math.max(1, bodyBottom - top));
    const volumeHeight = (bar.v / maxVolume) * 24;
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = COLORS.volume;
    ctx.fillRect(x - Math.max(1, xStep * 0.29), plotBottom + 26 - volumeHeight, Math.max(2, xStep * 0.58), volumeHeight);
    ctx.globalAlpha = 1;
  }
  drawSeries(ctx, fastValues, xAt, yAt, COLORS.fast);
  drawSeries(ctx, slowValues, xAt, yAt, COLORS.slow);
  const lastBar = data.at(-1);
  const lastColor = lastBar.c >= lastBar.o ? COLORS.candleUp : COLORS.candleDown;
  const lastY = Math.min(Math.max(yAt(lastBar.c), bounds.top), candleAreaBottom);
  ctx.setLineDash([4, 3]);
  line(ctx, 40, lastY, width - 8, lastY, lastColor, 1);
  ctx.setLineDash([]);
  text(ctx, lastBar.c.toFixed(2), width - 8, lastY - 4, lastColor, "right");
  if (Number.isInteger(hover) && hover >= 0 && hover < data.length) drawHover(ctx, data[hover], xAt(hover), yAt, width, candleAreaBottom, bounds.top);
}

/**
 * Pointer crosshair + OHLC tooltip for the main price chart.
 * Pure geometry: candleHoverAt maps a CSS-pixel x to a bar; drawHover renders it.
 * Keyboard/screen-reader users get the same OHLC from the screener and positions tables.
 */
export function candleHoverAt(bars, width, x, { window = 90 } = {}) {
  if (!bars?.length || !Number.isFinite(x) || !Number.isFinite(width) || width <= 52) return null;
  const data = bars.slice(-window);
  const xStep = (width - 52) / data.length;
  const index = Math.round((x - 42 - xStep / 2) / xStep);
  if (index < 0 || index >= data.length) return null;
  return { index, bar: data[index] };
}

function drawHover(ctx, bar, x, yAt, width, bottom, top) {
  ctx.setLineDash([3, 3]);
  line(ctx, x, top, x, bottom, "#8b90a7", 1);
  const closeY = yAt(bar.c);
  line(ctx, 40, closeY, width - 8, closeY, "#8b90a7", 1);
  ctx.setLineDash([]);
  const lines = [`O ${bar.o.toFixed(2)}  H ${bar.h.toFixed(2)}`, `L ${bar.l.toFixed(2)}  C ${bar.c.toFixed(2)}`];
  ctx.font = "11px ui-monospace, monospace";
  const boxWidth = 148, boxHeight = 34;
  const boxX = Math.min(Math.max(x + 10, 44), Math.max(44, width - boxWidth - 4));
  const boxY = Math.min(Math.max(closeY - boxHeight - 8, top + 2), bottom - boxHeight - 2);
  ctx.fillStyle = "#1b1e27";
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeStyle = "#3a3f52";
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxWidth - 1, boxHeight - 1);
  text(ctx, lines[0], boxX + 8, boxY + 14);
  text(ctx, lines[1], boxX + 8, boxY + 28);
}

function drawSeries(ctx, values, xAt, yAt, color) {
  ctx.beginPath();
  let started = false;
  values.forEach((value, i) => {
    if (!Number.isFinite(value)) { started = false; return; }
    if (!started) { ctx.moveTo(xAt(i), yAt(value)); started = true; }
    else ctx.lineTo(xAt(i), yAt(value));
  });
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke();
}

export function drawLine(canvas, values, { color = COLORS.fast, height = 220, labels = true, baseline = null, oosStart = null } = {}) {
  if (!canvas || !values?.length) return;
  const { ctx, width } = prepare(canvas, height);
  const bounds = chartBounds(values, 16, labels ? 28 : 12, height);
  const xAt = (i) => 40 + (width - 52) * (i / Math.max(1, values.length - 1));
  const yAt = (v) => bounds.top + (bounds.max - v) / (bounds.max - bounds.min) * bounds.plotHeight;
  for (let i = 0; i <= 3; i++) {
    const y = bounds.top + i * bounds.plotHeight / 3;
    line(ctx, 40, y, width - 8, y, COLORS.grid);
    text(ctx, (bounds.max - i * (bounds.max - bounds.min) / 3).toFixed(0), 36, y + 4, COLORS.text, "right");
  }
  if (baseline !== null && Number.isFinite(baseline)) line(ctx, 40, yAt(baseline), width - 8, yAt(baseline), COLORS.grid, 1);
  drawSeries(ctx, values, xAt, yAt, color);
  // IS／OOS 視覺文法：IS 壓暗段＋OOS 強調分界線，兩段永遠標示，不混成一條曲線。
  if (Number.isInteger(oosStart) && oosStart > 0 && oosStart < values.length) {
    const x = xAt(oosStart);
    ctx.setLineDash([5, 4]);
    line(ctx, x, bounds.top, x, bounds.top + bounds.plotHeight, "#4da3ff", 1.5);
    ctx.setLineDash([]);
    text(ctx, "IS", x - 6, bounds.top + 10, COLORS.text, "right");
    text(ctx, "OOS", x + 6, bounds.top + 10, "#4da3ff", "left");
  }
  if (labels) {
    text(ctx, "起點", 40, height - 7, COLORS.text, "left");
    text(ctx, "最新", width - 8, height - 7, COLORS.text, "right");
  }
}

export { COLORS };
