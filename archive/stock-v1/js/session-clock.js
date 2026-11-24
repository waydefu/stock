"use strict";

const POLICIES = Object.freeze({
  TW: Object.freeze({ market: "TW", timezone: "Asia/Taipei", calendar: "simplified-weekday", currency: "TWD" }),
  US: Object.freeze({ market: "US", timezone: "America/New_York", calendar: "simplified-weekday", currency: "USD" }),
});

function partsFor(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(({ type }) => type !== "literal").map(({ type, value }) => [type, value]));
}

export class MarketSessionClock {
  policy(market) {
    const policy = POLICIES[market];
    if (!policy) throw new Error(`unsupported market: ${market}`);
    return { ...policy };
  }

  sessionKey(market, timestamp = new Date().toISOString()) {
    const policy = this.policy(market);
    const date = new Date(timestamp);
    if (Number.isNaN(date.valueOf())) throw new Error("invalid timestamp for market session clock");
    const parts = partsFor(date, policy.timezone);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
}

export { POLICIES };
