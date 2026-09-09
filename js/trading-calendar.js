"use strict";

import { MarketSessionClock } from "./session-clock.js";

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
