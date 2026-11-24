import assert from "node:assert/strict";
import test from "node:test";
import { SYMBOLS, quote } from "../js/data.js";
import { validateTick } from "../js/market-rules.js";
import { buildOrderCandidate } from "../js/order-candidate.js";
import { RiskEngine } from "../js/risk.js";
import { MemoryStorage, PaperBroker } from "../js/paper.js";
import { executePaperOrder } from "../js/order-service.js";

const TAIPEI_SESSION = Date.parse("2026-09-15T02:00:00Z");

test("all listed TW simulated quotes pass validateTick", () => {
  const tw = SYMBOLS.filter((item) => item.market === "TW");
  assert.equal(tw.length, 6);
  for (const meta of tw) {
    const q = quote(meta.code);
    const decision = validateTick("TW", q.price);
    assert.equal(decision.ok, true, `${meta.code} price ${q.price} ${decision.code}`);
    assert.equal(validateTick("TW", q.prev).ok, true, `${meta.code} prev ${q.prev}`);
  }
});

test("TW odd-lot built like the UI fills during the Taipei session", () => {
  const q = quote("2330");
  const candidate = buildOrderCandidate({
    market: "TW",
    symbol: "2330",
    side: "buy",
    qty: 10,
    price: q.price,
    lot: "oddLot",
    quote: q,
    clientOrderId: "flow-2330",
  });
  assert.equal(candidate.referencePrice, q.prev);
  const broker = new PaperBroker({ storage: new MemoryStorage() });
  const risk = new RiskEngine();
  const preview = risk.approveOrder(broker.snapshot("TW", { 2330: q }), candidate, { now: TAIPEI_SESSION });
  assert.equal(preview.code, "APPROVED");
  const result = executePaperOrder({
    broker,
    risk: new RiskEngine(),
    order: candidate,
    quotes: { 2330: q },
    now: TAIPEI_SESSION,
  });
  assert.equal(result.filled, true);
  assert.equal(result.decision.code, "APPROVED");
  assert.equal(broker.snapshot("TW", { 2330: q }).positions["2330"].qty, 10);
});

test("preview and confirm share the rejection code when reference price is missing", () => {
  const q = quote("2330");
  const candidate = buildOrderCandidate({
    market: "TW",
    symbol: "2330",
    side: "buy",
    qty: 10,
    price: q.price,
    lot: "oddLot",
    quote: {},
    clientOrderId: "flow-missing-ref",
  });
  assert.equal(candidate.referencePrice, undefined);
  const broker = new PaperBroker({ storage: new MemoryStorage() });
  const preview = new RiskEngine().approveOrder(broker.snapshot("TW", { 2330: q }), candidate, { now: TAIPEI_SESSION });
  const confirm = executePaperOrder({
    broker,
    risk: new RiskEngine(),
    order: candidate,
    quotes: { 2330: q },
    now: TAIPEI_SESSION,
  });
  assert.equal(preview.code, "REFERENCE_PRICE_REQUIRED");
  assert.equal(confirm.decision.code, preview.code);
  assert.equal(confirm.filled, false);
});

test("US orders do not require a reference price", () => {
  const q = quote("AAPL");
  const candidate = buildOrderCandidate({
    market: "US",
    symbol: "AAPL",
    side: "buy",
    qty: 1,
    price: q.price,
    lot: "regular",
    quote: q,
    clientOrderId: "flow-aapl",
  });
  assert.equal(candidate.referencePrice, undefined);
  const broker = new PaperBroker({ storage: new MemoryStorage() });
  const decision = new RiskEngine().approveOrder(broker.snapshot("US", { AAPL: q }), candidate, { now: TAIPEI_SESSION });
  assert.equal(decision.code, "APPROVED");
});

test("Fugle-shaped quote uses previousClose as the TW reference", () => {
  const candidate = buildOrderCandidate({
    market: "TW",
    symbol: "2330",
    side: "buy",
    qty: 1,
    price: 1150,
    lot: "oddLot",
    quote: { price: 1150, previousClose: 1100 },
    clientOrderId: "flow-fugle-shape",
  });
  assert.equal(candidate.referencePrice, 1100);
});
