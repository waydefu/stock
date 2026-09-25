/* Pure order-ticket builder. UI and tests share this so preview carries referencePrice. */
"use strict";

export function referencePriceFromQuote(quote) {
  if (!quote || typeof quote !== "object") return null;
  if (Number.isFinite(quote.prev)) return quote.prev;
  if (Number.isFinite(quote.previousClose)) return quote.previousClose;
  return null;
}

export function buildOrderCandidate({
  market,
  symbol,
  side,
  qty,
  price,
  lot,
  quote = null,
  clientOrderId,
  orderType = "limit",
} = {}) {
  const candidate = { market, symbol, side, qty, price, lot, clientOrderId, orderType };
  if (market === "TW") {
    const referencePrice = referencePriceFromQuote(quote);
    if (Number.isFinite(referencePrice) && referencePrice > 0) candidate.referencePrice = referencePrice;
  }
  return candidate;
}
