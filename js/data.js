/* 行情資料層：確定性種子隨機（mulberry32）產生模擬 OHLC。
   同一 symbol 永遠產生同一條序列 → 回測可重現（reproducible）。
   真實接線時把 `getBars` 換成 Shioaji／Alpaca adapter 即可，UI 不動。 */
"use strict";

/** 字串 → 32bit 種子（FNV-1a） */
export function seedFromString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 標的靜態表：code, name, market(TW/US), base(起始價), ccy, drift, vol, pe, yield, cap(億) */
export const SYMBOLS = [
  { code: "2330", name: "台積電", market: "TW", base: 1080, ccy: "TWD", drift: 0.0006, vol: 0.016, pe: 28.4, yield: 1.6, cap: 280000 },
  { code: "2317", name: "鴻海", market: "TW", base: 185, ccy: "TWD", drift: 0.0003, vol: 0.014, pe: 14.2, yield: 3.1, cap: 25600 },
  { code: "2454", name: "聯發科", market: "TW", base: 1420, ccy: "TWD", drift: 0.0005, vol: 0.020, pe: 22.1, yield: 4.8, cap: 22600 },
  { code: "2881", name: "富邦金", market: "TW", base: 88, ccy: "TWD", drift: 0.0002, vol: 0.011, pe: 10.6, yield: 4.2, cap: 11400 },
  { code: "1301", name: "台塑", market: "TW", base: 52, ccy: "TWD", drift: -0.0002, vol: 0.012, pe: 31.5, yield: 2.9, cap: 3300 },
  { code: "2603", name: "長榮", market: "TW", base: 198, ccy: "TWD", drift: 0.0004, vol: 0.024, pe: 6.8, yield: 8.5, cap: 4200 },
  { code: "AAPL", name: "蘋果", market: "US", base: 232, ccy: "USD", drift: 0.0005, vol: 0.015, pe: 34.8, yield: 0.5, cap: 3520000 },
  { code: "NVDA", name: "輝達", market: "US", base: 138, ccy: "USD", drift: 0.0012, vol: 0.028, pe: 54.2, yield: 0.1, cap: 3380000 },
  { code: "TSLA", name: "特斯拉", market: "US", base: 248, ccy: "USD", drift: 0.0004, vol: 0.034, pe: 66.3, yield: 0.0, cap: 795000 },
  { code: "MSFT", name: "微軟", market: "US", base: 428, ccy: "USD", drift: 0.0005, vol: 0.014, pe: 35.1, yield: 0.7, cap: 3180000 },
  { code: "AMD", name: "超微", market: "US", base: 122, ccy: "USD", drift: 0.0003, vol: 0.026, pe: 44.7, yield: 0.0, cap: 198000 },
  { code: "META", name: "Meta", market: "US", base: 585, ccy: "USD", drift: 0.0007, vol: 0.020, pe: 27.9, yield: 0.3, cap: 1480000 },
];

export function getSymbol(code) {
  return SYMBOLS.find((s) => s.code === code);
}

const BAR_COUNT = 250;

/* 快取：每個 symbol 只算一次 */
const cache = new Map();

/** 取日 K（含今天共 BAR_COUNT 根）。bar: {t, o, h, l, c, v} */
export function getBars(code) {
  if (cache.has(code)) return cache.get(code);
  const meta = getSymbol(code);
  if (!meta) throw new Error("unknown symbol: " + code);
  const rnd = mulberry32(seedFromString("stock-v1:" + code));
  // 用高斯近似（Box-Muller）讓走勢像真的
  let gaussSpare = null;
  const gauss = () => {
    if (gaussSpare !== null) { const v = gaussSpare; gaussSpare = null; return v; }
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    const m = Math.sqrt(-2 * Math.log(u));
    gaussSpare = m * Math.sin(2 * Math.PI * v);
    return m * Math.cos(2 * Math.PI * v);
  };
  const bars = [];
  let price = meta.base * (1 - meta.drift * BAR_COUNT * 0.5); // 從過去推到現在
  // 交易日曆：跳過週末（美股也一樣簡化）
  const day = 86400000;
  // 固定模擬終點，讓跨程序回測也能重現，而不是依賴本機目前時間。
  const simulationEnd = Date.UTC(2025, 11, 31);
  let t = simulationEnd - BAR_COUNT * day;
  const dow = () => new Date(t).getDay();
  for (let i = 0; i < BAR_COUNT; i++) {
    while (dow() === 0 || dow() === 6) t += day;
    const shock = gauss() * meta.vol;
    // 偶發跳空（財報／事件）：約 2% 機率 ±3σ
    const gap = rnd() < 0.02 ? (rnd() < 0.5 ? -1 : 1) * 3 * meta.vol : 0;
    const o = price * (1 + gap * 0.4);
    const c = o * (1 + meta.drift + shock);
    const h = Math.max(o, c) * (1 + Math.abs(gauss()) * meta.vol * 0.35);
    const l = Math.min(o, c) * (1 - Math.abs(gauss()) * meta.vol * 0.35);
    const vBase = meta.market === "TW" ? 18_000 : 45_000_000;
    const v = Math.round(vBase * (0.5 + rnd() * 1.6) * (1 + Math.abs(shock) * 22));
    bars.push({ t, o: r2(o), h: r2(h), l: r2(l), c: r2(c), v });
    price = c;
    t += day;
  }
  cache.set(code, bars);
  return bars;
}

function r2(x) { return Math.round(x * 100) / 100; }

/** 收盤價序列 */
export function closes(code) { return getBars(code).map((b) => b.c); }

/** 最新價＋漲跌 */
export function quote(code) {
  const bars = getBars(code);
  const last = bars[bars.length - 1], prev = bars[bars.length - 2];
  const chg = last.c - prev.c;
  return { code, price: last.c, prev: prev.c, chg: r2(chg), pct: r2((chg / prev.c) * 100), vol: last.v };
}

/* ---- 技術指標（純函數，可單測） ---- */

/** 簡單移動平均；前 length-1 個為 null */
export function sma(values, length) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= length) sum -= values[i - length];
    if (i >= length - 1) out[i] = sum / length;
  }
  return out;
}

/** RSI（Wilder）；前 length 個為 null */
export function rsi(values, length = 14) {
  const out = new Array(values.length).fill(null);
  if (values.length <= length) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= length; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let ag = gain / length, al = loss / length;
  out[length] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = length + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    ag = (ag * (length - 1) + Math.max(d, 0)) / length;
    al = (al * (length - 1) + Math.max(-d, 0)) / length;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

/** 20 日高低（Donchian 軌道用，不含當根 → 無未來函數） */
export function rollingHigh(values, length) {
  const out = new Array(values.length).fill(null);
  for (let i = length; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - length; j < i; j++) m = Math.max(m, values[j]);
    out[i] = m;
  }
  return out;
}

/** 量比 = 今日量 / 20 日均量 */
export function volumeRatio(code) {
  const bars = getBars(code);
  const n = bars.length;
  const avg = bars.slice(n - 21, n - 1).reduce((a, b) => a + b.v, 0) / 20;
  return Math.round((bars[n - 1].v / avg) * 100) / 100;
}

/** 格式化：千分位＋幣別 */
export function fmtPrice(x, ccy = "TWD") {
  const d = ccy === "TWD" ? 2 : 2;
  return Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function fmtInt(x) { return Math.round(x).toLocaleString("en-US"); }
export function fmtDate(t) {
  const d = new Date(t);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
