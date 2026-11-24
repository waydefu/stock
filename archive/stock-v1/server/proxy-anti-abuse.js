/* Trusted proxy anti-abuse state.
   Pure state transitions only: no HTTP, no Fugle schema, no logging, no secrets. */
"use strict";

export const DEFAULT_RATE_LIMIT = Object.freeze({ capacity: 60, refillPerSecond: 1 });
export const DEFAULT_QUOTE_CACHE_TTL_MS = 4_000;
export const DEFAULT_DAILY_UPSTREAM_BUDGET = 5_000;
export const MAX_CLIENT_BUCKETS = 10_000;
export const MAX_QUOTE_CACHE_ENTRIES = 200;

/* Supports the current token-bucket shape and the legacy sliding-window config. */
export function normalizeRateLimit(opt) {
  if (opt === false) return null;
  if (opt === undefined || opt === null) return { ...DEFAULT_RATE_LIMIT };
  if (Number.isFinite(opt.capacity) && opt.capacity > 0 && Number.isFinite(opt.refillPerSecond) && opt.refillPerSecond > 0) {
    return { capacity: opt.capacity, refillPerSecond: opt.refillPerSecond };
  }
  const maxRequests = Number.isInteger(opt.maxRequests) && opt.maxRequests > 0 ? opt.maxRequests : DEFAULT_RATE_LIMIT.capacity;
  const windowMs = Number.isFinite(opt.windowMs) && opt.windowMs > 0 ? opt.windowMs : 60_000;
  return { capacity: maxRequests, refillPerSecond: (maxRequests * 1000) / windowMs };
}

export function evictStaleBuckets(state) {
  if (state.buckets.size <= MAX_CLIENT_BUCKETS) return;
  const entries = [...state.buckets.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  for (const [key] of entries) {
    if (state.buckets.size <= MAX_CLIENT_BUCKETS) break;
    state.buckets.delete(key);
  }
}

/* null = allowed; integer seconds = retry-after. */
export function takeToken(state, clientKey) {
  const rl = state.rateLimit;
  if (!rl) return null;
  const now = state.clock();
  let bucket = state.buckets.get(clientKey);
  if (!bucket) {
    bucket = { tokens: rl.capacity, updatedAt: now };
    state.buckets.set(clientKey, bucket);
    evictStaleBuckets(state);
  }
  const elapsedSeconds = Math.max(0, now - bucket.updatedAt) / 1000;
  bucket.tokens = Math.min(rl.capacity, bucket.tokens + elapsedSeconds * rl.refillPerSecond);
  bucket.updatedAt = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return null;
  }
  return Math.max(1, Math.ceil((1 - bucket.tokens) / rl.refillPerSecond));
}

/* UTC daily boundary; budget 0/null means disabled. */
export function consumeUpstreamBudget(state) {
  const budget = state.dailyUpstreamBudget;
  if (!budget) return { allowed: true, used: 0, budget };
  const day = new Date(state.clock()).toISOString().slice(0, 10);
  if (state.budgetDay !== day) {
    state.budgetDay = day;
    state.budgetUsed = 0;
  }
  if (state.budgetUsed >= budget) return { allowed: false, used: state.budgetUsed, budget };
  state.budgetUsed += 1;
  return { allowed: true, used: state.budgetUsed, budget };
}

export function readQuoteCache(state, symbol) {
  const entry = state.quoteCache.get(symbol);
  if (!entry) return null;
  const age = state.clock() - entry.storedAt;
  if (age > state.quoteCacheTtlMs) {
    state.quoteCache.delete(symbol);
    return null;
  }
  return { ...entry, age };
}

export function writeQuoteCache(state, symbol, entry) {
  state.quoteCache.set(symbol, entry);
  if (state.quoteCache.size > MAX_QUOTE_CACHE_ENTRIES) {
    const oldest = [...state.quoteCache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt)[0];
    if (oldest) state.quoteCache.delete(oldest[0]);
  }
}
