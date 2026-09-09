/* Market-specific constraints. TW fields are sourced; US remains intentionally simplified. */
"use strict";

const TW_RULE_SOURCE = "https://www.twse.com.tw/en/products/system/trading.html";
const TW_ODD_LOT_SOURCE = "https://twse-regulation.twse.com.tw/ENG/EN/law/DAT0201.aspx?FLCODE=FL007115";
const TW_LIMIT_SOURCE = "https://twse-regulation.twse.com.tw/ENG/EN/law/DOC01.aspx?FLCODE=FL007304&FLNO=63";

export const MARKET_RULES = Object.freeze({
  TW: Object.freeze({
    market: "TW",
    currency: "TWD",
    timezone: "Asia/Taipei",
    mode: "sourced-partial",
    regularUnit: 1000,
    oddLot: Object.freeze({ min: 1, max: 999, orderType: "limit", timeInForce: "DAY" }),
    dailyPriceLimitPct: 10,
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
    sources: Object.freeze([]),
  }),
});

export function getMarketRules(market) {
  const rules = MARKET_RULES[market];
  if (!rules) throw new Error(`不支援市場：${market}`);
  return rules;
}

export function validateQuantity(market, quantity, lot = "regular") {
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

export { TW_LIMIT_SOURCE, TW_ODD_LOT_SOURCE, TW_RULE_SOURCE };
