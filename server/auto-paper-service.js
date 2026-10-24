/* Server-authoritative Automated Paper runtime.
   This module is paper-only and exposes NO HTTP mutation endpoint.

   Enabling requires explicit operator confirmations:
   - durable storage is mounted at AUTO_PAPER_STATE_FILE
   - compute is always-on (not a sleeping free web service)

   The confirmations are deployment assertions, not magic detection. Missing/invalid
   assertions fail startup when AUTO_PAPER_SERVER_ENABLED=1. */
"use strict";

import { isAbsolute } from "node:path";
import { MULTI_HORIZON_TREND } from "../js/alpha.js";
import { AUTO_PAPER_ALLOCATION, evaluateAutoPaperPromotion } from "../js/auto-paper-promotion.js";
import { AutoPaperRunner, latestCompletedTwBar } from "../js/auto-paper-runner.js";
import { FugleProxyAdapter } from "../js/fugle-proxy-adapter.js";
import { createAppPaperRuntime } from "../js/paper-runtime.js";
import { fixedFraction } from "../js/portfolio.js";
import { AuditLog, DEFAULT_RISK, RiskEngine } from "../js/risk.js";
import { fugleResearchRange } from "../js/research-range.js";
import { MarketSessionClock } from "../js/session-clock.js";
import { TW_INSTRUMENT, createTwFeeModel } from "../js/tw-fee-model.js";
import { FileKeyValueStorage, acquireExclusiveFileLease } from "./file-kv-storage.js";
import { ForwardTestJournal } from "./forward-test-journal.js";

export const SERVER_AUTO_META_KEY = "tw-us-stock-server-auto-meta-v1";
export const DEFAULT_SERVER_AUTO_INTERVAL_MS = 5 * 60_000;

const SYMBOL_PATTERN = /^[A-Za-z0-9]{4,6}$/;

function positiveInterval(raw) {
  const value = Number(raw ?? DEFAULT_SERVER_AUTO_INTERVAL_MS);
  if (!Number.isInteger(value) || value < 60_000 || value > 60 * 60_000) {
    throw new Error("AUTO_PAPER_INTERVAL_MS 必須介於 60000 與 3600000");
  }
  return value;
}

export function resolveServerAutoPaperConfig(env = {}) {
  const enabled = env.AUTO_PAPER_SERVER_ENABLED === "1";
  if (!enabled) return Object.freeze({ enabled: false });

  if (env.AUTO_PAPER_DURABLE_STORAGE_CONFIRMED !== "1") {
    throw new Error("AUTO_PAPER server 拒絕啟動：未確認 durable storage");
  }
  if (env.AUTO_PAPER_ALWAYS_ON_CONFIRMED !== "1") {
    throw new Error("AUTO_PAPER server 拒絕啟動：未確認 always-on compute");
  }
  const stateFile = env.AUTO_PAPER_STATE_FILE;
  if (typeof stateFile !== "string" || !stateFile || !isAbsolute(stateFile)) {
    throw new Error("AUTO_PAPER_STATE_FILE 必須是 persistent mount 上的絕對路徑");
  }
  const symbol = String(env.AUTO_PAPER_SYMBOL ?? "").trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) throw new Error("AUTO_PAPER_SYMBOL 必須是 4-6 碼有效代號");

  return Object.freeze({
    enabled: true,
    stateFile,
    symbol,
    intervalMs: positiveInterval(env.AUTO_PAPER_INTERVAL_MS),
  });
}

function taipeiYMD(now) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

function loadMeta(storage) {
  const raw = storage.getItem(SERVER_AUTO_META_KEY);
  if (!raw) return { version: 1, lastPromotionBar: null, lastGatePass: null, lastCycleAt: null };
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const failure = new Error(`server auto meta 損壞：${error.message}`);
    failure.code = "DURABLE_STATE_INVALID";
    throw failure;
  }
  if (!value || value.version !== 1) {
    const failure = new Error("server auto meta 版本不支援");
    failure.code = "DURABLE_STATE_INVALID";
    throw failure;
  }
  return value;
}

function saveMeta(storage, meta) {
  storage.setItem(SERVER_AUTO_META_KEY, JSON.stringify({ version: 1, ...meta }));
}

function providerGuard(envelope, symbol) {
  if (envelope?.meta?.provider !== "FUGLE" || envelope?.meta?.symbol !== symbol) {
    const error = new Error("server Auto Paper provenance 非 FUGLE／symbol 不一致");
    error.code = "DATA_INVALID";
    throw error;
  }
}

export function createServerAutoPaperService({
  config,
  proxyBaseUrl,
  storage = null,
  adapter = null,
  clock = () => Date.now(),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  logger = () => {},
  promotionEvaluator = evaluateAutoPaperPromotion,
} = {}) {
  if (!config || config.enabled !== true) {
    return Object.freeze({
      enabled: false,
      start: async () => ({ enabled: false }),
      stop: () => {},
      runOnce: async () => ({ ok: false, code: "SERVER_AUTO_DISABLED" }),
      status: () => ({ enabled: false }),
    });
  }
  if (typeof proxyBaseUrl !== "string" || !proxyBaseUrl) throw new Error("server Auto Paper 需要 internal proxy base URL");

  let authorityLease = null;
  try {
  if (!storage) authorityLease = acquireExclusiveFileLease(config.stateFile);
  const durable = storage ?? new FileKeyValueStorage(config.stateFile);
  const nowIso = () => new Date(clock()).toISOString();
  const { broker } = createAppPaperRuntime({ storage: durable, now: nowIso, strictPersistence: true });
  const risk = new RiskEngine(DEFAULT_RISK, { storage: durable, now: clock, strictPersistence: true });
  const audit = new AuditLog({ storage: durable, now: nowIso, strictPersistence: true });
  const data = adapter ?? new FugleProxyAdapter({ baseUrl: proxyBaseUrl, clock });
  const sessionClock = new MarketSessionClock();
  const researchFeeModel = createTwFeeModel({ instrumentType: TW_INSTRUMENT.STOCK, name: "server-auto-research-tw-stock-v1" });
  const runner = new AutoPaperRunner({
    strategy: MULTI_HORIZON_TREND,
    allocate: fixedFraction(AUTO_PAPER_ALLOCATION),
    broker,
    risk,
    storage: durable,
    market: "TW",
    symbol: config.symbol,
    clock,
    sessionClock,
    canTrade: () => true,
    auditEvent: (event, details) => audit.record(event, { ...details, actor: "server-auto-paper" }),
  });
  const journal = new ForwardTestJournal({ storage: durable });

  let meta = loadMeta(durable);
  let timer = null;
  let running = false;
  let fatal = null;
  let barsCache = null;
  let barsCacheKey = null;

  function log(event, details = {}) {
    logger({ component: "server-auto-paper", event, symbol: config.symbol, ...details });
  }

  function isDurableFailure(error) {
    return String(error?.code ?? "").startsWith("DURABLE_");
  }

  function accountForQuote(quoteEnvelope) {
    const quote = quoteEnvelope?.data;
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) return null;
    return broker.snapshot("TW", { [config.symbol]: { price: quote.price } });
  }

  function recordEvidence({ now, result, promotion = null, quoteEnvelope = null, accountBefore = null, detailCode = null }) {
    return journal.recordCycle({
      timestamp: new Date(now).toISOString(),
      symbol: config.symbol,
      code: result?.code ?? "UNKNOWN",
      ok: result?.ok === true,
      detailCode,
      lifecycle: runner.status().lifecycle,
      promotionPass: typeof promotion?.pass === "boolean" ? promotion.pass : null,
      marketPrice: Number.isFinite(quoteEnvelope?.data?.price) ? quoteEnvelope.data.price : null,
      equityBefore: Number.isFinite(accountBefore?.equity) ? accountBefore.equity : null,
      account: accountForQuote(quoteEnvelope),
      fills: result?.fills ?? [],
    });
  }

  function cacheKey(now) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(now));
    const p = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const minutes = Number(p.hour) * 60 + Number(p.minute);
    return `${p.year}-${p.month}-${p.day}:${minutes >= 13 * 60 + 30 ? "postclose" : "preclose"}`;
  }

  async function completedBars(now) {
    const key = cacheKey(now);
    if (barsCache && barsCacheKey === key) return barsCache;
    const to = taipeiYMD(now);
    const { from } = fugleResearchRange({ to });
    const response = await data.getBarsAsync(config.symbol, { from, to });
    providerGuard(response?.envelope, config.symbol);
    const allBars = response.envelope.data;
    const completed = latestCompletedTwBar(allBars, now);
    if (!completed) {
      const error = new Error("沒有可用的完成日 K");
      error.code = "NO_COMPLETED_BAR";
      throw error;
    }
    barsCache = allBars.slice(0, completed.index + 1);
    barsCacheKey = key;
    return barsCache;
  }

  function markFatal(error) {
    fatal = { code: error?.code ?? "SERVER_AUTO_FATAL", message: error?.message ?? "unknown" };
    if (timer !== null) {
      try { clearIntervalImpl(timer); } catch { /* already cleared */ }
      timer = null;
    }
    log("FATAL", fatal);
  }

  async function refreshPromotion(bars, now) {
    const latestBar = bars.at(-1)?.t ?? null;
    const status = runner.status();
    const needsEvaluation = meta.lastPromotionBar !== latestBar || status.approval?.pass !== true;
    if (!needsEvaluation) return { pass: true, cached: true, gate: status.approval?.evidence?.checks ?? [] };

    const promotion = promotionEvaluator({
      symbol: config.symbol,
      bars,
      allocation: AUTO_PAPER_ALLOCATION,
      feeModel: researchFeeModel,
    });
    const evidence = {
      ...promotion.evidence,
      latestCompletedBar: latestBar,
      evaluatedAt: new Date(now).toISOString(),
      dataProvider: "FUGLE",
    };
    runner.recordResearchGate({ pass: promotion.gate.pass, evidence });
    meta = {
      ...meta,
      lastPromotionBar: latestBar,
      lastGatePass: promotion.gate.pass,
      lastPromotionAt: new Date(now).toISOString(),
    };
    saveMeta(durable, meta);
    audit.record("SERVER_PROMOTION_EVALUATED", {
      actor: "server-auto-paper",
      symbol: config.symbol,
      pass: promotion.gate.pass,
      checks: promotion.gate.checks,
      latestCompletedBar: latestBar,
    });
    log("PROMOTION", { pass: promotion.gate.pass, latestCompletedBar: latestBar });

    if (promotion.gate.pass && runner.status().lifecycle !== "PAPER_ENABLED") {
      runner.arm();
    }
    return { pass: promotion.gate.pass, cached: false, gate: promotion.gate };
  }

  async function runOnce() {
    if (fatal) return { ok: false, code: fatal.code, fatal: true };
    if (running) return { ok: false, code: "SERVER_AUTO_CYCLE_BUSY" };
    running = true;
    const now = clock();
    let promotion = null;
    let quoteEnvelope = null;
    let accountBefore = null;
    try {
      const bars = await completedBars(now);
      promotion = await refreshPromotion(bars, now);
      if (!promotion.pass) {
        const result = { ok: false, code: "PROMOTION_GATE_FAIL", promotion, runner: runner.status() };
        meta = { ...meta, lastCycleAt: new Date(now).toISOString(), lastCycleCode: result.code };
        saveMeta(durable, meta);
        recordEvidence({ now, result, promotion });
        return result;
      }

      quoteEnvelope = await data.quoteAsync(config.symbol);
      providerGuard(quoteEnvelope, config.symbol);
      accountBefore = accountForQuote(quoteEnvelope);
      const result = await runner.cycle({ bars, quoteEnvelope, now });
      meta = { ...meta, lastCycleAt: new Date(now).toISOString(), lastCycleCode: result.code };
      saveMeta(durable, meta);
      recordEvidence({ now, result, promotion, quoteEnvelope, accountBefore });
      log("CYCLE", { code: result.code });
      return { ...result, promotion };
    } catch (error) {
      let finalError = error;
      if (!isDurableFailure(finalError)) {
        try {
          meta = { ...meta, lastCycleAt: new Date(now).toISOString(), lastCycleCode: finalError?.code ?? "UNKNOWN" };
          saveMeta(durable, meta);
          recordEvidence({
            now,
            result: { ok: false, code: finalError?.code ?? "UNKNOWN" },
            promotion,
            quoteEnvelope,
            accountBefore,
            detailCode: finalError?.code ?? "UNKNOWN",
          });
        } catch (evidenceError) {
          finalError = evidenceError;
        }
      }
      try {
        audit.record("SERVER_AUTO_CYCLE_ERROR", {
          actor: "server-auto-paper",
          symbol: config.symbol,
          code: finalError?.code ?? "UNKNOWN",
          message: finalError?.message ?? "unknown",
        });
      } catch (auditError) {
        finalError = auditError;
      }
      if (isDurableFailure(finalError)) {
        markFatal(finalError);
      } else {
        log("CYCLE_ERROR", { code: finalError?.code ?? "UNKNOWN", message: finalError?.message ?? "unknown" });
      }
      return { ok: false, code: finalError?.code ?? "UNKNOWN", error: finalError?.message ?? "unknown", fatal: Boolean(fatal) };
    } finally {
      running = false;
    }
  }

  async function start() {
    if (timer !== null) return status();
    timer = setIntervalImpl(() => { void runOnce(); }, config.intervalMs);
    timer?.unref?.();
    const first = await runOnce();
    log("STARTED", { intervalMs: config.intervalMs, firstCode: first.code });
    return status();
  }

  function stop() {
    if (timer !== null) {
      try { clearIntervalImpl(timer); } catch { /* already cleared */ }
      timer = null;
    }
    if (authorityLease) {
      try {
        authorityLease.release();
        authorityLease = null;
      } catch (error) {
        log("LEASE_RELEASE_FAILED", { code: error?.code ?? "UNKNOWN", message: error?.message ?? "unknown" });
      }
    }
    log("STOPPED");
  }

  function status() {
    return {
      enabled: true,
      fatal,
      running,
      scheduled: timer !== null,
      intervalMs: config.intervalMs,
      symbol: config.symbol,
      lifecycle: runner.status().lifecycle,
      lastOutcome: runner.status().lastOutcome,
      lastPromotionBar: meta.lastPromotionBar ?? null,
      lastGatePass: meta.lastGatePass ?? null,
      lastCycleAt: meta.lastCycleAt ?? null,
      lastCycleCode: meta.lastCycleCode ?? null,
      authorityLease: storage ? "injected-test-storage" : (authorityLease ? "HELD" : "RELEASED"),
      evidence: journal.summary(),
    };
  }

  return Object.freeze({ enabled: true, start, stop, runOnce, status });
  } catch (error) {
    if (authorityLease) {
      try { authorityLease.release(); } catch { /* preserve original startup failure */ }
    }
    throw error;
  }
}
