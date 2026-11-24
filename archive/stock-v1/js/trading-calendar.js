/* 交易日曆：兩種模式，都誠實標示自己的涵蓋範圍。
   - SimplifiedWeekdayCalendar：只看市場當地星期幾（US 仍用這個，US 交易所日曆未建模）。
   - MarketHolidayCalendar：TW 加上 TWSE 官方休市日快照；涵蓋範圍外退回 weekday 規則。 */
"use strict";

import { MarketSessionClock } from "./session-clock.js";
import { TW_MARKET_HOLIDAYS, isCoveredDate } from "./tw-market-holidays.js";

export class SimplifiedWeekdayCalendar {
  mode = "SIMPLIFIED_WEEKDAY";
  #clock;

  constructor(clock = new MarketSessionClock()) {
    this.#clock = clock;
  }

  policy(market) {
    return { ...this.#clock.policy(market), holidaySupport: "none", sessionHours: "not-modeled" };
  }

  isTradingDay(market, timestamp) {
    const policy = this.policy(market);
    const date = new Date(timestamp);
    if (Number.isNaN(date.valueOf())) throw new Error("invalid timestamp for simplified trading calendar");
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: policy.timezone, weekday: "short" }).format(date);
    return weekday !== "Sat" && weekday !== "Sun";
  }
}

/* 市場當地日期字串（YYYY-MM-DD）。用 Intl 取當地日期，避免 UTC 偏移錯一天。 */
function dateKeyInTimezone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export class MarketHolidayCalendar {
  mode = "SOURCED_HOLIDAYS";
  #clock;
  #holidays;

  constructor(clock = new MarketSessionClock(), holidays = TW_MARKET_HOLIDAYS) {
    this.#clock = clock;
    this.#holidays = holidays;
  }

  policy(market) {
    const base = this.#clock.policy(market);
    if (market === "TW") {
      return {
        ...base,
        holidaySupport: "sourced-snapshot",
        sessionHours: "not-modeled",
        holidaySource: this.#holidays.source,
        holidayAccessed: this.#holidays.accessed,
        holidayCoverage: `${this.#holidays.effectiveFrom}..${this.#holidays.effectiveTo}`,
      };
    }
    return { ...base, holidaySupport: "none", sessionHours: "not-modeled" };
  }

  /** 該日若是官方休市日，回傳名稱；否則 null。 */
  holidayFor(market, timestamp) {
    if (market !== "TW") return null;
    const date = new Date(timestamp);
    if (Number.isNaN(date.valueOf())) throw new Error("invalid timestamp for trading calendar");
    const key = dateKeyInTimezone(date, this.policy(market).timezone);
    return this.#holidays.days[key] ?? null;
  }

  isTradingDay(market, timestamp) {
    const policy = this.policy(market);
    const date = new Date(timestamp);
    if (Number.isNaN(date.valueOf())) throw new Error("invalid timestamp for trading calendar");
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: policy.timezone, weekday: "short" }).format(date);
    if (weekday === "Sat" || weekday === "Sun") return false;
    return this.holidayFor(market, timestamp) === null;
  }

  /** 該日期是否落在官方快照的涵蓋範圍內（範圍外只能靠 weekday 規則）。 */
  covers(market, timestamp) {
    if (market !== "TW") return false;
    const date = new Date(timestamp);
    const key = dateKeyInTimezone(date, this.policy(market).timezone);
    return isCoveredDate(key);
  }
}

export { TW_MARKET_HOLIDAYS };
