/* Market-specific constraints. TW fields are sourced; US remains intentionally simplified. */
import { SimplifiedWeekdayCalendar } from "./trading-calendar.js";

const calendar = new SimplifiedWeekdayCalendar();

const TW_RULE_SOURCE = "https://www.twse.com.tw/en/products/system/trading.html";
const TW_ODD_LOT_SOURCE = "https://twse-regulation.twse.com.tw/ENG/EN/law/DAT0201.aspx?FLCODE=FL007115";
const TW_LIMIT_SOURCE = "https://twse-regulation.twse.com.tw/ENG/EN/law/DOC01.aspx?FLCODE=FL007304&FLNO=63";

// TWSE tick size schedule per 營業細則第62條
// Price band: [minPrice, maxPrice) -> tick size
// 0-10: 0.01, 10-50: 0.05, 50-100: 0.10, 100-500: 0.50, 500-1000: 1.00, >=1000: 5.00
const TW_TICK_SCHEDULE = Object.freeze([
  { min: 0, max: 10, tick: 0.01 },
  { min: 10, max: 50, tick: 0.05 },
  { min: 50, max: 100, tick: 0.10 },
  { min: 100, max: 500, tick: 0.50 },
  { min: 500, max: 1000, tick: 1.00 },
  { min: 1000, max: Infinity, tick: 5.00 },
]);

// TWSE trading sessions (Asia/Taipei time)
const TW_SESSIONS = Object.freeze([
  { name: "preMarket", type: "callAuction", start: "08:30", end: "09:00", orderTypes: ["limit"] },
  { name: "regular", type: "continuous", start: "09:00", end: "13:25", orderTypes: ["limit", "market"] },
  { name: "preClose", type: "callAuction", start: "13:25", end: "13:30", orderTypes: ["limit"] },
]);

export const MARKET_RULES = Object.freeze({
  TW: Object.freeze({
    market: "TW",
    currency: "TWD",
    timezone: "Asia/Taipei",
    mode: "sourced-partial",
    regularUnit: 1000,
    oddLot: Object.freeze({ min: 1, max: 999, orderType: "limit", timeInForce: "DAY" }),
    dailyPriceLimitPct: 10,
    tickSchedule: TW_TICK_SCHEDULE,
    sessions: TW_SESSIONS,
    sources: Object.freeze([TW_RULE_SOURCE, TW_ODD_LOT_SOURCE, TW_LIMIT_SOURCE]),
  }),
  US: Object.freeze({
    market: "US",
    currency: "USD",
    timezone: "America/New_York",
    mode: "simplified-prototype",
    regularUnit: 1,
    oddLot: null,
    dailyPriceLimitPct: null,
    tickSchedule: null,
    sessions: null,
    sources: Object.freeze([]),
  }),
});

export function getMarketRules(market) {
  const rules = MARKET_RULES[market];
  if (!rules) throw new Error(`不支援市場：${market}`);
  return rules;
}

export function defaultLotForMarket(market) {
  return market === "TW" ? "oddLot" : "regular";
}

export function validateQuantity(market, quantity, lot = defaultLotForMarket(market)) {
  const rules = getMarketRules(market);
  if (!Number.isInteger(quantity) || quantity <= 0) return { ok: false, code: "INVALID_QUANTITY", reason: "數量必須是正整數" };
  if (market === "TW" && lot === "regular" && quantity % rules.regularUnit !== 0) {
    return { ok: false, code: "REGULAR_LOT_UNIT", reason: `台股整股數量必須是 ${rules.regularUnit} 的倍數` };
  }
  if (market === "TW" && lot === "oddLot" && (quantity < rules.oddLot.min || quantity > rules.oddLot.max)) {
    return { ok: false, code: "ODD_LOT_RANGE", reason: `台股零股數量必須介於 ${rules.oddLot.min}–${rules.oddLot.max}` };
  }
  if (!["regular", "oddLot"].includes(lot)) return { ok: false, code: "INVALID_LOT", reason: "不支援的交易單位" };
  return { ok: true, code: "VALID" };
}

export { TW_LIMIT_SOURCE, TW_ODD_LOT_SOURCE, TW_RULE_SOURCE, TW_TICK_SCHEDULE, TW_SESSIONS };

/**
 * Get the tick size for a given price in TW market.
 * Returns the tick size or null if price is invalid.
 */
export function getTickSize(market, price) {
  const rules = getMarketRules(market);
  if (!rules.tickSchedule) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  for (const band of rules.tickSchedule) {
    if (price >= band.min && price < band.max) return band.tick;
  }
  return rules.tickSchedule[rules.tickSchedule.length - 1].tick;
}

/**
 * Validate that a price conforms to the tick size schedule.
 * Returns { ok: true, code: "VALID" } or { ok: false, code, reason, expectedTick }.
 */
export function validateTick(market, price) {
  const rules = getMarketRules(market);
  if (!rules.tickSchedule) return { ok: true, code: "NO_TICK_RULE", reason: "此市場無價差規則，略過驗證" };
  if (!Number.isFinite(price) || price < 0) return { ok: false, code: "INVALID_PRICE", reason: "價格必須是非負數" };
  const tick = getTickSize(market, price);
  if (tick === null) return { ok: false, code: "INVALID_PRICE", reason: "無法決定價差" };
  // Check if price is a multiple of tick (allowing floating point precision)
  const remainder = Math.round((price / tick) * 10000) % 10000;
  if (remainder !== 0) {
    const nearest = Math.round(price / tick) * tick;
    return {
      ok: false,
      code: "INVALID_TICK",
      reason: `價格 ${price} 不符合價差 ${tick}；最接近合法價格為 ${nearest.toFixed(2)}`,
      expectedTick: tick,
    };
  }
  return { ok: true, code: "VALID" };
}

/**
 * Calculate the daily price limit (limit up / limit down) for TW market.
 * referencePrice: 開盤競價基準價 (auction reference price)
 * Returns { limitUp, limitDown } or null if not applicable.
 */
export function calculatePriceLimits(market, referencePrice) {
  const rules = getMarketRules(market);
  if (!rules.dailyPriceLimitPct || !Number.isFinite(referencePrice) || referencePrice <= 0) return null;
  const pct = rules.dailyPriceLimitPct / 100;
  const rawUp = referencePrice * (1 + pct);
  const rawDown = referencePrice * (1 - pct);
  // Apply tick size rounding per TWSE rules
  const tickUp = getTickSize(market, rawUp);
  const tickDown = getTickSize(market, rawDown);
  if (!tickUp || !tickDown) return { limitUp: rawUp, limitDown: rawDown };
  // Limit up: round down to nearest tick (don't exceed the limit)
  // Limit down: round up to nearest tick (don't exceed the limit)
  const limitUp = Math.round(Math.floor(rawUp / tickUp) * tickUp * 100) / 100;
  const limitDown = Math.round(Math.ceil(rawDown / tickDown) * tickDown * 100) / 100;
  return { limitUp, limitDown };
}

/**
 * Validate that a price is within daily price limits.
 * Returns { ok: true, code: "VALID" } or { ok: false, code, reason, limitUp, limitDown }.
 */
export function validatePriceLimit(market, price, referencePrice) {
  const rules = getMarketRules(market);
  if (!rules.dailyPriceLimitPct) return { ok: true, code: "NO_PRICE_LIMIT", reason: "此市場無漲跌幅限制，略過驗證" };
  const limits = calculatePriceLimits(market, referencePrice);
  if (!limits) return { ok: false, code: "INVALID_REFERENCE", reason: "無法計算漲跌停價（參考價無效）" };
  if (price > limits.limitUp) {
    return { ok: false, code: "PRICE_LIMIT_UP", reason: `價格 ${price} 超過漲停價 ${limits.limitUp}`, limitUp: limits.limitUp, limitDown: limits.limitDown };
  }
  if (price < limits.limitDown) {
    return { ok: false, code: "PRICE_LIMIT_DOWN", reason: `價格 ${price} 低於跌停價 ${limits.limitDown}`, limitUp: limits.limitUp, limitDown: limits.limitDown };
  }
  return { ok: true, code: "VALID" };
}

/**
 * Get the current trading session for a market at a given timestamp.
 * Returns session object or null if outside trading hours or non-trading day.
 */
export function getCurrentSession(market, timestamp = Date.now()) {
  const rules = getMarketRules(market);
  if (!rules.sessions) return null;

  // Check if it's a trading day
  if (!calendar.isTradingDay(market, timestamp)) return null;

  const date = new Date(timestamp);
  const tz = rules.timezone;
  // Use Intl.DateTimeFormat for reliable timezone conversion
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit", minute: "2-digit" });
  const parts = formatter.formatToParts(date);
  let hour = 0, minute = 0;
  for (const part of parts) {
    if (part.type === "hour") hour = Number(part.value);
    if (part.type === "minute") minute = Number(part.value);
  }
  const minutes = hour * 60 + minute;
  for (const session of rules.sessions) {
    const [sh, sm] = session.start.split(":").map(Number);
    const [eh, em] = session.end.split(":").map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (minutes >= startMin && minutes < endMin) return session;
  }
  return null;
}

/**
 * Validate that an order type is allowed in the current session.
 */
export function validateOrderTypeInSession(market, orderType, timestamp = Date.now()) {
  const session = getCurrentSession(market, timestamp);
  if (!session) return { ok: false, code: "OUTSIDE_TRADING_HOURS", reason: "非交易時段，無法下單" };
  if (!session.orderTypes.includes(orderType)) {
    return { ok: false, code: "ORDER_TYPE_NOT_ALLOWED", reason: `當前時段（${session.name}）不允許 ${orderType} 單` };
  }
  return { ok: true, code: "VALID", session };
}
