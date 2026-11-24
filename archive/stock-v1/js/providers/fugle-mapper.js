/* Fugle REST provider mapping — the ONLY place that knows Fugle schemas.
   Sourced from official docs (verified 2026-09-11):
   - intraday quote: GET /intraday/quote/{symbol}, X-API-KEY
     (https://developer.fugle.tw/docs/data/http-api/intraday/quote)
   - historical candles: GET /historical/candles/{symbol}?from&to&timeframe=D&fields&sort
     (https://developer.fugle.tw/docs/data/http-api/historical/candles)
   - error codes 401/403/404/429
     (https://developer.fugle.tw/docs/data/error_codes)
   Rules: missing critical field → DATA_INVALID (never 0/"" / Date.now());
   unknown optional field → null; intraday *Time fields are MICROSECONDS
   (16-digit example values), converted by Math.floor(us / 1000). */
"use strict";

import { DATA_ERROR_CODE, MarketDataError, normalizeBars } from "../market-data-contract.js";

export const FUGLE_PROVIDER_ID = "FUGLE";

/* Fugle market別 → repo market。未知 market 不猜，給 null。 */
export const FUGLE_MARKET_MAP = Object.freeze({ TSE: "TW", OTC: "TW", ESB: "TW", TIB: "TW" });

function fail(code, message) {
  throw new MarketDataError(code, message);
}

/** Sourced conversion: Fugle intraday timestamps are microseconds since epoch. */
export function mapFugleTimestamp(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value / 1000);
}

/** Map intraday/quote payload → normalizeQuote-shaped input (+ repo market). */
export function mapFugleQuote(raw) {
  if (!raw || typeof raw !== "object") fail(DATA_ERROR_CODE.DATA_INVALID, "Fugle quote 不是物件");
  const symbol = typeof raw.symbol === "string" && raw.symbol ? raw.symbol : null;
  if (!symbol) fail(DATA_ERROR_CODE.DATA_INVALID, "Fugle quote 缺 symbol");
  if (!Number.isFinite(raw.lastPrice)) fail(DATA_ERROR_CODE.DATA_INVALID, `Fugle quote ${symbol} 缺 lastPrice`);
  const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);
  return {
    market: FUGLE_MARKET_MAP[raw.market] ?? null,
    code: symbol,
    price: raw.lastPrice,
    prev: finiteOrNull(raw.previousClose),
    chg: finiteOrNull(raw.change),
    pct: finiteOrNull(raw.changePercent),
    vol: finiteOrNull(raw.total?.tradeVolume),
    t: mapFugleTimestamp(raw.lastUpdated),
  };
}

/** Map historical/candles payload → normalized bars + adjustment flag. */
export function mapFugleBars(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.data)) {
    fail(DATA_ERROR_CODE.DATA_INVALID, "Fugle candles 缺 data 陣列");
  }
  const bars = raw.data.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(DATA_ERROR_CODE.DATA_INVALID, `Fugle candle #${index} 不是物件`);
    const t = parseDailyDate(entry.date);
    for (const key of ["open", "high", "low", "close", "volume"]) {
      if (!Number.isFinite(entry[key])) fail(DATA_ERROR_CODE.DATA_INVALID, `Fugle candle ${entry.date ?? `#${index}`} 缺 ${key}`);
    }
    return { t, o: entry.open, h: entry.high, l: entry.low, c: entry.close, v: entry.volume };
  });
  return {
    bars: normalizeBars(bars),
    adjusted: typeof raw.adjusted === "boolean" ? raw.adjusted : null,
  };
}

/* Daily timeframe dates are yyyy-MM-dd (Taipei calendar day). Minute ISO dates
   are rejected: this mapper only serves the D timeframe the proxy requests. */
function parseDailyDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(DATA_ERROR_CODE.DATA_INVALID, `Fugle candle 日期格式不支援：${value}`);
  }
  const t = Date.parse(`${value}T00:00:00+08:00`);
  if (!Number.isFinite(t)) fail(DATA_ERROR_CODE.DATA_INVALID, `Fugle candle 日期無效：${value}`);
  return t;
}
