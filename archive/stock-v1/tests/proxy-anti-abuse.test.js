import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CLIENT_BUCKETS,
  consumeUpstreamBudget,
  evictStaleBuckets,
  normalizeRateLimit,
  readQuoteCache,
  takeToken,
  writeQuoteCache,
} from "../server/proxy-anti-abuse.js";

test("rate limit config preserves token and legacy window semantics", () => {
  assert.equal(normalizeRateLimit(false), null);
  assert.deepEqual(normalizeRateLimit(null), { capacity: 60, refillPerSecond: 1 });
  assert.deepEqual(normalizeRateLimit({ capacity: 3, refillPerSecond: 2 }), { capacity: 3, refillPerSecond: 2 });
  assert.deepEqual(normalizeRateLimit({ maxRequests: 120, windowMs: 60_000 }), { capacity: 120, refillPerSecond: 2 });
});

test("per-client token bucket refills deterministically", () => {
  let now = 0;
  const state = {
    rateLimit: { capacity: 2, refillPerSecond: 1 },
    buckets: new Map(),
    clock: () => now,
  };
  assert.equal(takeToken(state, "A"), null);
  assert.equal(takeToken(state, "A"), null);
  assert.equal(takeToken(state, "A"), 1);
  assert.equal(takeToken(state, "B"), null, "another client must have an independent bucket");
  now = 1000;
  assert.equal(takeToken(state, "A"), null);
});

test("bucket eviction caps attacker-controlled client cardinality", () => {
  const state = { buckets: new Map() };
  for (let i = 0; i < MAX_CLIENT_BUCKETS + 2; i++) {
    state.buckets.set(String(i), { updatedAt: i });
  }
  evictStaleBuckets(state);
  assert.equal(state.buckets.size, MAX_CLIENT_BUCKETS);
  assert.equal(state.buckets.has("0"), false);
  assert.equal(state.buckets.has("1"), false);
});

test("daily upstream budget resets only on UTC day change", () => {
  let now = Date.parse("2026-10-24T23:59:00Z");
  const state = { dailyUpstreamBudget: 2, budgetDay: null, budgetUsed: 0, clock: () => now };
  assert.deepEqual(consumeUpstreamBudget(state), { allowed: true, used: 1, budget: 2 });
  assert.deepEqual(consumeUpstreamBudget(state), { allowed: true, used: 2, budget: 2 });
  assert.deepEqual(consumeUpstreamBudget(state), { allowed: false, used: 2, budget: 2 });
  now = Date.parse("2026-10-25T00:00:00Z");
  assert.deepEqual(consumeUpstreamBudget(state), { allowed: true, used: 1, budget: 2 });
});

test("quote cache exposes age, expires, and stays bounded", () => {
  let now = 1000;
  const state = { quoteCache: new Map(), quoteCacheTtlMs: 4000, clock: () => now };
  writeQuoteCache(state, "2330", { storedAt: 1000, data: { price: 100 } });
  now = 3000;
  assert.equal(readQuoteCache(state, "2330").age, 2000);
  now = 6001;
  assert.equal(readQuoteCache(state, "2330"), null);

  now = 10_000;
  for (let i = 0; i < 201; i++) {
    writeQuoteCache(state, String(i), { storedAt: i, data: { price: i } });
  }
  assert.equal(state.quoteCache.size, 200);
  assert.equal(state.quoteCache.has("0"), false);
});
