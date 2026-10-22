/* Market-specific constraints. TW fields are sourced; US remains intentionally simplified. */
import { SimplifiedWeekdayCalendar } from "./trading-calendar.js";

const calendar = new SimplifiedWeekdayCalendar();

const TW_RULE_SOURCE = "https://www.twse.com.tw/en/products/system/trading.html";
const TW_ODD_LOT_SOURCE = "https://twse-regulation.twse.com.tw/ENG/EN/law/DAT0201.aspx?FLCODE=FL007115";
const TW_LIMIT_SOURCE = "https://twse-regulation.twse.com.tw/ENG/EN/law/DOC01.aspx?FLCODE=FL007304&FLNO=63";
// 營業細則第62條：股票價格升降單位
const TW_TICK_RULE_SOURCE = "https://twse-regulation.twse.com.tw/TW/law/DOC01.aspx?FLCODE=FL007304&FLNO=62";
// 受益憑證買賣辦法第7條：ETF／主動式ETF／REITs 價格升降單位
const TW_BENEFICIAL_CERT_SOURCE = "https://twse-regulation.twse.com.tw/TW/law/DAT0201.aspx?FLCODE=FL007114";
// 集中市場交易制度介紹：上市證券申報買賣價格升降單位總表（股票／權證／ETF 分欄）
const TW_TICK_TABLE_SOURCE = "https://www.twse.com.tw/zh/products/system/trading.html";

// TWSE 營業細則第62條：股票之價格升降單位（含存託憑證、外國股票、封閉型基金受益憑證等）
// Price band: [minPrice, maxPrice) -> tick size
// 0-10: 0.01, 10-50: 0.05, 50-100: 0.10, 100-500: 0.50, 500-1000: 1.00, >=1000: 5.00
const TW_STOCK_TICK_SCHEDULE = Object.freeze([
  { min: 0, max: 10, tick: 0.01 },
  { min: 10, max: 50, tick: 0.05 },
  { min: 50, max: 100, tick: 0.10 },
  { min: 100, max: 500, tick: 0.50 },
  { min: 500, max: 1000, tick: 1.00 },
  { min: 1000, max: Infinity, tick: 5.00 },
]);

// 相容用名稱：既有呼叫端以 TW_TICK_SCHEDULE 指涉股票表（維持原意，不改變既有 API）
const TW_TICK_SCHEDULE = TW_STOCK_TICK_SCHEDULE;

// TWSE 受益憑證買賣辦法第7條第2項：指數股票型基金受益憑證（ETF）、主動式交易所交易基金受益憑證、
// 不動產投資信託受益證券（REITs）每受益權單位市價未滿五十元者為一分，五十元以上者為五分。
// TWSE 集中市場交易制度介紹「升降單位」表另將 ETN 與 ETF／REITs 併列同一欄，規則相同。
const TW_ETF_TICK_SCHEDULE = Object.freeze([
  { min: 0, max: 50, tick: 0.01 },
  { min: 50, max: Infinity, tick: 0.05 },
]);

// TWSE 集中市場交易制度介紹「升降單位」表：認購（售）權證、認股權憑證
// 0-5: 0.01, 5-10: 0.05, 10-50: 0.10, 50-100: 0.50, 100-500: 1.00, >=500: 5.00
const TW_WARRANT_TICK_SCHEDULE = Object.freeze([
  { min: 0, max: 5, tick: 0.01 },
  { min: 5, max: 10, tick: 0.05 },
  { min: 10, max: 50, tick: 0.10 },
  { min: 50, max: 100, tick: 0.50 },
  { min: 100, max: 500, tick: 1.00 },
  { min: 500, max: Infinity, tick: 5.00 },
]);

// 商品類別 -> 價格升降單位表。
// 未驗證／未列出的商品類別一律回相容的「股票表」：既有呼叫端（不帶 instrumentType）行為不變。
const TW_TICK_SCHEDULES = Object.freeze({
  stock: TW_STOCK_TICK_SCHEDULE,
  tdr: TW_STOCK_TICK_SCHEDULE,
  closedfund: TW_STOCK_TICK_SCHEDULE,
  etf: TW_ETF_TICK_SCHEDULE,
  etn: TW_ETF_TICK_SCHEDULE,
  reit: TW_ETF_TICK_SCHEDULE,
  warrant: TW_WARRANT_TICK_SCHEDULE,
});

// 商品類別字串正規化：忽略大小寫與分隔符（closedFund / closed-fund / CLOSEDFUND 視為同一類）
const INSTRUMENT_TYPE_ALIAS_CACHE = new Map();
function normalizeInstrumentType(instrumentType) {
  if (typeof instrumentType !== "string") return "stock";
  const cached = INSTRUMENT_TYPE_ALIAS_CACHE.get(instrumentType);
  if (cached !== undefined) return cached;
  const key = instrumentType.toLowerCase().replace(/[^a-z]/g, "") || "stock";
  INSTRUMENT_TYPE_ALIAS_CACHE.set(instrumentType, key);
  return key;
}

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
    tickSchedule: TW_STOCK_TICK_SCHEDULE,
    tickSchedules: TW_TICK_SCHEDULES,
    sessions: TW_SESSIONS,
    sources: Object.freeze([TW_RULE_SOURCE, TW_ODD_LOT_SOURCE, TW_LIMIT_SOURCE, TW_TICK_RULE_SOURCE, TW_BENEFICIAL_CERT_SOURCE, TW_TICK_TABLE_SOURCE]),
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
    tickSchedules: null,
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

export { TW_LIMIT_SOURCE, TW_ODD_LOT_SOURCE, TW_RULE_SOURCE, TW_TICK_SCHEDULE, TW_SESSIONS, TW_STOCK_TICK_SCHEDULE, TW_ETF_TICK_SCHEDULE, TW_WARRANT_TICK_SCHEDULE, TW_TICK_SCHEDULES, TW_TICK_RULE_SOURCE, TW_BENEFICIAL_CERT_SOURCE, TW_TICK_TABLE_SOURCE };

// ─────────────────────────────────────────────────────────────────────────────
// 最小報價單位（minor unit）運算
//
// 說明：TW 的「最小報價單位」是一分（0.01 元）。營業細則第62條的所有價格升降單位
// （0.01 / 0.05 / 0.10 / 0.50 / 1.00 / 5.00）都是一分的整數倍，因此把價格轉成
// 「分」的整數之後，漲跌停價、跳動單位對齊等運算可以全程用整數完成，避開浮點誤差
// （例如 1.10 * 0.9 在 IEEE-754 下是 0.9900000000000001，取 ceil 後會得到 1.00 而非 0.99）。
// ─────────────────────────────────────────────────────────────────────────────

/** 市場最小報價單位：TW 一分 = 0.01 元。 */
export const TW_MINOR_UNIT = 0.01;

const MINOR_UNIT_BY_MARKET = Object.freeze({ TW: 0.01, US: 0.01 });

/** 取得市場的最小報價單位（US 目前無升降單位表，僅供最小單位換算使用）。 */
export function minorUnitForMarket(market) {
  return MINOR_UNIT_BY_MARKET[market] ?? 0.01;
}

/**
 * 把價格轉成最小報價單位的整數表示（例：TW 一分 → 1.21 元 = 121）。
 * 不在整數格上的價格會四捨五入到最近的格（供顯示／推算用；嚴格驗證請用 isOnMinorUnitGrid）。
 */
export function toMinorUnits(price, unit = TW_MINOR_UNIT) {
  if (!Number.isFinite(price)) return null;
  return Math.round(price / unit);
}

/** 價格是否落在最小報價單位的整數格上（例：TW 0.01 元格）。 */
export function isOnMinorUnitGrid(price, unit = TW_MINOR_UNIT) {
  if (!Number.isFinite(price)) return false;
  const scaled = price / unit;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/** 把最小報價單位的整數表示還原成價格（避免 121 * 0.01 = 1.2100000000000002 這類浮點殘差）。 */
export function fromMinorUnits(minor, unit = TW_MINOR_UNIT) {
  if (!Number.isInteger(minor)) return null;
  return Number((minor * unit).toFixed(8));
}

// 以最小報價單位表示的升降單位表快取（避免每次查表都做換算）
// 結構：market -> instrumentType -> schedule
const UNIT_SCHEDULE_CACHE = new Map();

/** 把以元表示的升降單位表轉成以最小報價單位表示（整數）並快取。 */
function unitSchedule(market, instrumentType) {
  const type = normalizeInstrumentType(instrumentType);
  let byType = UNIT_SCHEDULE_CACHE.get(market);
  if (!byType) {
    byType = new Map();
    UNIT_SCHEDULE_CACHE.set(market, byType);
  }
  if (byType.has(type)) return byType.get(type);
  const schedule = getTickSchedule(market, type);
  const unit = minorUnitForMarket(market);
  const converted = schedule
    ? Object.freeze(schedule.map((band) => Object.freeze({
      minUnits: Math.round(band.min / unit),
      maxUnits: band.max === Infinity ? Infinity : Math.round(band.max / unit),
      tickUnits: Math.round(band.tick / unit),
    })))
    : null;
  byType.set(type, converted);
  return converted;
}

/**
 * 依商品類別取得價格升降單位表。
 * instrumentType 預設為 "stock"（股票表），以維持既有呼叫端（不帶此參數）的行為。
 * 未列出的商品類別也回退到股票表，並在程式碼註解標示為未驗證。
 */
export function getTickSchedule(market, instrumentType = "stock") {
  const rules = getMarketRules(market);
  if (!rules.tickSchedule) return null;
  if (market === "TW") {
    const key = normalizeInstrumentType(instrumentType);
    // 未驗證的商品別（例如未建模的債券、權證以外新商品）一律沿用股票表
    return TW_TICK_SCHEDULES[key] ?? TW_TICK_SCHEDULES.stock;
  }
  return rules.tickSchedule;
}

/**
 * Get the tick size for a given price in TW market.
 * Returns the tick size or null if price is invalid.
 * instrumentType: 商品類別（"stock" / "etf" / "etn" / "reit" / "warrant" / "closedfund" / "tdr"），
 *                 預設 "stock" 以維持既有呼叫端行為。
 */
export function roundToTick(market, price, instrumentType = "stock") {
  if (!Number.isFinite(price)) return price;
  const schedule = getTickSchedule(market, instrumentType);
  if (!schedule) return price;
  const tick = getTickSize(market, price, instrumentType);
  if (!tick) return price;
  const unit = minorUnitForMarket(market);
  const minor = toMinorUnits(price, unit);
  if (minor === null) return price;
  const tickUnits = Math.round(tick / unit);
  const aligned = Math.round(minor / tickUnits) * tickUnits;
  return fromMinorUnits(aligned, unit);
}

export function getTickSize(market, price, instrumentType = "stock") {
  const schedule = getTickSchedule(market, instrumentType);
  if (!schedule) return null;
  if (!Number.isFinite(price) || price < 0) return null;
  for (const band of schedule) {
    if (price >= band.min && price < band.max) return band.tick;
  }
  return schedule[schedule.length - 1].tick;
}

/**
 * Validate that a price conforms to the tick size schedule.
 * Returns { ok: true, code: "VALID" } or { ok: false, code, reason, expectedTick }.
 */
export function validateTick(market, price, instrumentType = "stock") {
  const schedule = getTickSchedule(market, instrumentType);
  if (!schedule) return { ok: true, code: "NO_TICK_RULE", reason: "此市場無價差規則，略過驗證" };
  if (!Number.isFinite(price) || price < 0) return { ok: false, code: "INVALID_PRICE", reason: "價格必須是非負數" };
  const tick = getTickSize(market, price, instrumentType);
  if (tick === null) return { ok: false, code: "INVALID_PRICE", reason: "無法決定價差" };
  const unit = minorUnitForMarket(market);
  const tickUnits = Math.round(tick / unit);
  const minor = toMinorUnits(price, unit);
  if (minor === null) return { ok: false, code: "INVALID_PRICE", reason: "價格必須是非負數" };
  const nearest = fromMinorUnits(Math.round(minor / tickUnits) * tickUnits, unit);
  // 以整數最小單位判斷：價格必須同時落在最小報價單位格上，且為該價位帶 tick 的整數倍
  if (!isOnMinorUnitGrid(price, unit) || minor % tickUnits !== 0) {
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
 *
 * 計算全程以「最小報價單位」的整數完成，避免 IEEE-754 浮點誤差導致差一檔：
 *   漲停 = 不超過 基準價×(1+pct) 的最大合法 tick 價（floor）
 *   跌停 = 不低於 基準價×(1-pct) 的最小合法 tick 價（ceil）
 */
export function calculatePriceLimits(market, referencePrice, instrumentType = "stock") {
  const rules = getMarketRules(market);
  if (!rules.dailyPriceLimitPct || !Number.isFinite(referencePrice) || referencePrice <= 0) return null;
  const pct = rules.dailyPriceLimitPct;
  const unit = minorUnitForMarket(market);
  const schedule = unitSchedule(market, instrumentType);
  const fallback = () => {
    const ratio = pct / 100;
    return { limitUp: referencePrice * (1 + ratio), limitDown: referencePrice * (1 - ratio) };
  };
  if (!schedule) return fallback();
  // 參考價必須落在最小報價單位格上（實務上開盤競價基準一定是合法價格）
  if (!isOnMinorUnitGrid(referencePrice, unit)) return fallback();
  const refUnits = toMinorUnits(referencePrice, unit);
  // 以有理數表示漲跌停原價：raw = refUnits * (100 ± pct) / 100（單位：分）
  const den = 100;
  const upNum = refUnits * (100 + pct);
  const downNum = refUnits * (100 - pct);
  const upBand = bandForRatio(upNum, den, schedule);
  const downBand = bandForRatio(downNum, den, schedule);
  // floor：upNum / (den * tick) 的整數除法即為 floor
  const upSteps = Math.floor(upNum / (den * upBand.tickUnits));
  // ceil：以整數公式 ceil(a/b) = floor((a + b - 1)/b) 避免浮點誤差
  const downSteps = Math.floor((downNum + den * downBand.tickUnits - 1) / (den * downBand.tickUnits));
  return {
    limitUp: fromMinorUnits(upSteps * upBand.tickUnits, unit),
    limitDown: fromMinorUnits(downSteps * downBand.tickUnits, unit),
  };
}

/**
 * 以有理數（num/den，單位：分）找出所在的價位帶。
 */
function bandForRatio(num, den, schedule) {
  for (const band of schedule) {
    if (num >= band.minUnits * den && num < band.maxUnits * den) return band;
  }
  return schedule[schedule.length - 1];
}

/**
 * Validate that a price is within daily price limits.
 * Returns { ok: true, code: "VALID" } or { ok: false, code, reason, limitUp, limitDown }.
 */
export function validatePriceLimit(market, price, referencePrice, instrumentType = "stock") {
  const rules = getMarketRules(market);
  if (!rules.dailyPriceLimitPct) return { ok: true, code: "NO_PRICE_LIMIT", reason: "此市場無漲跌幅限制，略過驗證" };
  const limits = calculatePriceLimits(market, referencePrice, instrumentType);
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
  let hour = 0;
  let minute = 0;
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
 *
 * lot（選填）：交易單位（"regular" / "oddLot"）。台股零股依「上市股票零股交易辦法」第3條
 * 與集中市場「盤中零股交易：委託種類以限價為之，且限當日有效」，零股不接受市價單，
 * 因此帶入 lot === "oddLot" 時市價單會回 ODD_LOT_LIMIT_ONLY。
 * 不帶 lot 的既有呼叫（舊 API）行為不變：此時不套用零股限制。
 */
export function validateOrderTypeInSession(market, orderType, timestamp = Date.now(), lot = undefined) {
  const session = getCurrentSession(market, timestamp);
  if (!session) return { ok: false, code: "OUTSIDE_TRADING_HOURS", reason: "非交易時段，無法下單" };
  // 零股僅接受限價單（上市股票零股交易辦法第3條第2項、盤中零股「委託種類：以限價為之」）
  if (market === "TW" && lot === "oddLot" && orderType !== "limit") {
    return { ok: false, code: "ODD_LOT_LIMIT_ONLY", reason: "台股零股交易僅接受限價單（限價當日有效），請改用限價單下單" };
  }
  if (!session.orderTypes.includes(orderType)) {
    return { ok: false, code: "ORDER_TYPE_NOT_ALLOWED", reason: `當前時段（${session.name}）不允許 ${orderType} 單` };
  }
  return { ok: true, code: "VALID", session };
}
