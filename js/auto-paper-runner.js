/* Deterministic Automated Paper Trading v1.
   Scope: single-symbol, long-only paper forward test. No live broker path.

   Safety contract:
   - research gate must PASS before PAPER_ENABLED;
   - only completed bars produce signals;
   - one signal bar is evaluated once (persisted);
   - next-session fresh quote is required for execution;
   - every fill reuses order-service -> RiskEngine -> PaperBroker;
   - every non-duplicate fill is reconciled; mismatch trips kill switch.
*/
"use strict";

import { DATA_KINDS, FRESHNESS } from "./market-data-contract.js";
import { buildOrderCandidate } from "./order-candidate.js";
import { ExecutionMode } from "./execution-model.js";
import { executePaperOrder, processPaperMatches } from "./order-service.js";
import { defaultLotForMarket, getCurrentSession } from "./market-rules.js";
import { MarketSessionClock } from "./session-clock.js";
import { LIFECYCLE, normalizeSignal, signalToTargetWeight, transitionLifecycle, validateStrategy } from "./strategy.js";

export const AUTO_PAPER_STATE_VERSION = 2;
export const AUTO_PAPER_STORAGE_KEY = "tw-us-stock-auto-paper-v1";

const TERMINAL = new Set([LIFECYCLE.KILL_SWITCHED, LIFECYCLE.RETIRED]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finiteFraction(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 1) throw new Error("allocator 必須回傳 (0,1] 的有限曝險比例");
  return n;
}

function defaultEntry(strategy) {
  return {
    version: AUTO_PAPER_STATE_VERSION,
    strategyId: strategy.id,
    strategyVersion: strategy.version,
    lifecycle: LIFECYCLE.DRAFT,
    approval: null,
    lastEvaluatedBar: null,
    pendingIntent: null,
    workingOrderIds: [],
    lastExecution: null,
    lastOutcome: "IDLE",
    updatedAt: null,
  };
}

function validEntry(value, strategy) {
  return value
    && value.version === AUTO_PAPER_STATE_VERSION
    && value.strategyId === strategy.id
    && value.strategyVersion === strategy.version
    && Object.values(LIFECYCLE).includes(value.lifecycle);
}

function taipeiClockParts(timestamp) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(timestamp));
  const p = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

function latestCompletedTwBar(bars, now) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const today = taipeiClockParts(now);
  for (let i = bars.length - 1; i >= 0; i--) {
    const bar = bars[i];
    if (!bar || !Number.isFinite(bar.t)) continue;
    const barDate = taipeiClockParts(bar.t).date;
    if (barDate < today.date) return { bar, index: i };
    if (barDate === today.date && today.minutes >= 13 * 60 + 30) return { bar, index: i };
  }
  return null;
}

function quoteMap(symbol, quote) {
  return { [symbol]: { price: quote.price } };
}

function quoteIsFresh(envelope) {
  const meta = envelope?.meta;
  if (!meta) return false;
  if (meta.dataKind === DATA_KINDS.SIMULATION) return true;
  return meta.stale !== true && meta.freshnessStatus === FRESHNESS.FRESH;
}

function splitDelta(market, delta) {
  const side = delta > 0 ? "buy" : "sell";
  const qty = Math.abs(delta);
  if (!Number.isInteger(qty) || qty <= 0) return [];
  if (market !== "TW") return [{ side, qty, lot: defaultLotForMarket(market) }];
  const regular = Math.floor(qty / 1000) * 1000;
  const odd = qty % 1000;
  const chunks = [];
  if (regular > 0) chunks.push({ side, qty: regular, lot: "regular" });
  if (odd > 0) chunks.push({ side, qty: odd, lot: "oddLot" });
  return chunks;
}

export class AutoPaperRunner {
  #strategy;
  #allocate;
  #broker;
  #risk;
  #audit;
  #storage;
  #market;
  #symbol;
  #clock;
  #sessionClock;
  #canTrade;
  #state;

  constructor({
    strategy,
    allocate,
    broker,
    risk,
    auditEvent = () => {},
    storage,
    market = "TW",
    symbol,
    clock = () => Date.now(),
    sessionClock = new MarketSessionClock(),
    canTrade = () => true,
  } = {}) {
    validateStrategy(strategy);
    if (typeof allocate !== "function") throw new Error("AutoPaperRunner 需要 Portfolio allocator");
    if (!broker || typeof broker.snapshot !== "function" || typeof broker.placeOrder !== "function") throw new Error("AutoPaperRunner 需要 PaperBroker");
    if (!risk || typeof risk.approveOrder !== "function" || typeof risk.trip !== "function") throw new Error("AutoPaperRunner 需要 RiskEngine");
    if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") throw new Error("AutoPaperRunner 需要 storage");
    if (typeof canTrade !== "function") throw new Error("AutoPaperRunner 需要 canTrade 權限函式");
    if (market !== "TW") throw new Error("Automated Paper v1 目前只開放 TW");
    if (typeof symbol !== "string" || !symbol) throw new Error("AutoPaperRunner 需要 symbol");

    this.#strategy = strategy;
    this.#allocate = allocate;
    this.#broker = broker;
    this.#risk = risk;
    this.#audit = auditEvent;
    this.#storage = storage;
    this.#market = market;
    this.#symbol = symbol;
    this.#clock = clock;
    this.#sessionClock = sessionClock;
    this.#canTrade = canTrade;
    this.#state = this.#load();
  }

  #key() {
    return `${this.#market}:${this.#symbol}:${this.#strategy.id}@${this.#strategy.version}`;
  }

  #loadAll() {
    try {
      const raw = this.#storage.getItem(AUTO_PAPER_STORAGE_KEY);
      if (!raw) return { version: AUTO_PAPER_STATE_VERSION, entries: {} };
      const parsed = JSON.parse(raw);
      if (parsed?.version !== AUTO_PAPER_STATE_VERSION || !parsed.entries || typeof parsed.entries !== "object") {
        return { version: AUTO_PAPER_STATE_VERSION, entries: {} };
      }
      return parsed;
    } catch {
      return { version: AUTO_PAPER_STATE_VERSION, entries: {} };
    }
  }

  #load() {
    const all = this.#loadAll();
    const entry = all.entries[this.#key()];
    return validEntry(entry, this.#strategy) ? entry : defaultEntry(this.#strategy);
  }

  #save() {
    this.#state.updatedAt = new Date(this.#clock()).toISOString();
    const all = this.#loadAll();
    all.entries[this.#key()] = this.#state;
    this.#storage.setItem(AUTO_PAPER_STORAGE_KEY, JSON.stringify(all));
  }

  status() {
    return clone({ market: this.#market, symbol: this.#symbol, ...this.#state });
  }

  recordResearchGate({ pass, evidence = {} } = {}) {
    if (pass === true) {
      let lifecycle = this.#state.lifecycle;
      if (lifecycle === LIFECYCLE.DRAFT) lifecycle = transitionLifecycle(lifecycle, LIFECYCLE.BACKTESTED);
      if (lifecycle === LIFECYCLE.BACKTESTED) lifecycle = transitionLifecycle(lifecycle, LIFECYCLE.RESEARCH_APPROVED);
      if (lifecycle === LIFECYCLE.PAUSED) lifecycle = transitionLifecycle(lifecycle, LIFECYCLE.RESEARCH_APPROVED);
      if (lifecycle === LIFECYCLE.KILL_SWITCHED) throw new Error("kill switch 狀態不可由研究 gate 自動解除");
      this.#state.lifecycle = lifecycle;
      this.#state.approval = { pass: true, evidence: clone(evidence), recordedAt: new Date(this.#clock()).toISOString() };
      this.#state.lastOutcome = "RESEARCH_APPROVED";
      this.#save();
      this.#audit("AUTO_RESEARCH_APPROVED", { symbol: this.#symbol, strategyId: this.#strategy.id, evidence });
      return this.status();
    }

    if (this.#state.lifecycle === LIFECYCLE.PAPER_ENABLED || this.#state.lifecycle === LIFECYCLE.RESEARCH_APPROVED) {
      this.#state.lifecycle = transitionLifecycle(this.#state.lifecycle, LIFECYCLE.PAUSED);
    } else if (this.#state.lifecycle === LIFECYCLE.DRAFT) {
      this.#state.lifecycle = transitionLifecycle(this.#state.lifecycle, LIFECYCLE.BACKTESTED);
    }
    this.#cancelWorking("research gate rejected");
    this.#state.approval = null;
    this.#state.pendingIntent = null;
    this.#state.lastOutcome = "RESEARCH_REJECTED";
    this.#save();
    this.#audit("AUTO_RESEARCH_REJECTED", { symbol: this.#symbol, strategyId: this.#strategy.id, evidence });
    return this.status();
  }

  arm() {
    if (!this.#state.approval?.pass) throw new Error("研究 Promotion Gate 尚未 PASS，不可啟用自動 Paper");
    if (this.#risk.isTripped?.()) throw new Error("Risk kill switch 已啟動，不可武裝");
    if (!this.#canTrade()) throw new Error("目前角色沒有 paper:order 權限，不可武裝");
    if (this.#state.lifecycle === LIFECYCLE.PAUSED) {
      this.#state.lifecycle = transitionLifecycle(this.#state.lifecycle, LIFECYCLE.RESEARCH_APPROVED);
    }
    if (this.#state.lifecycle === LIFECYCLE.RESEARCH_APPROVED) {
      this.#state.lifecycle = transitionLifecycle(this.#state.lifecycle, LIFECYCLE.PAPER_ENABLED);
    }
    if (this.#state.lifecycle !== LIFECYCLE.PAPER_ENABLED) throw new Error(`目前 lifecycle=${this.#state.lifecycle}，不可武裝`);
    this.#state.lastOutcome = "ARMED";
    this.#save();
    this.#audit("AUTO_PAPER_ARMED", { symbol: this.#symbol, strategyId: this.#strategy.id });
    return this.status();
  }

  pause(reason = "manual") {
    this.#cancelWorking(`pause:${reason}`);
    if (this.#state.lifecycle === LIFECYCLE.PAPER_ENABLED) {
      this.#state.lifecycle = transitionLifecycle(this.#state.lifecycle, LIFECYCLE.PAUSED);
    }
    this.#state.pendingIntent = null;
    this.#state.lastOutcome = "PAUSED";
    this.#save();
    this.#audit("AUTO_PAPER_PAUSED", { symbol: this.#symbol, strategyId: this.#strategy.id, reason });
    return this.status();
  }

  async cycle({ bars, quoteEnvelope, now = this.#clock() } = {}) {
    if (this.#state.lifecycle !== LIFECYCLE.PAPER_ENABLED) {
      return { ok: false, code: "AUTO_NOT_ENABLED", status: this.status() };
    }
    if (this.#risk.isTripped?.()) {
      this.#tripLifecycle("KILL_SWITCH_ACTIVE");
      return { ok: false, code: "KILL_SWITCH", status: this.status() };
    }

    const quote = quoteEnvelope?.data;
    if (!quote || quote.symbol !== this.#symbol || !Number.isFinite(quote.price) || quote.price <= 0) {
      return { ok: false, code: "INVALID_QUOTE", status: this.status() };
    }
    const quotes = quoteMap(this.#symbol, quote);

    // Existing working orders have priority over producing a new signal.
    if (this.#state.workingOrderIds.length) {
      const tracked = new Set(this.#state.workingOrderIds);
      const preExpired = this.#broker.expireOpenOrders(this.#market, { timestamp: new Date(now).toISOString() })
        .filter((order) => tracked.has(order.id));
      if (preExpired.length) {
        for (const order of preExpired) this.#audit("AUTO_ORDER_EXPIRED", { symbol: this.#symbol, strategyId: this.#strategy.id, orderId: order.id });
        const expiredIds = new Set(preExpired.map((order) => order.id));
        this.#state.workingOrderIds = this.#state.workingOrderIds.filter((id) => !expiredIds.has(id));
        if (!this.#state.workingOrderIds.length) {
          this.#state.lastOutcome = "ORDER_EXPIRED";
          this.#save();
          return { ok: false, code: "ORDER_EXPIRED", expired: preExpired, status: this.status() };
        }
      }
      if (!quoteIsFresh(quoteEnvelope)) {
        this.#state.lastOutcome = "STALE_QUOTE_BLOCKED";
        this.#save();
        return { ok: false, code: "STALE_QUOTE", status: this.status() };
      }
      const matched = processPaperMatches({
        broker: this.#broker,
        risk: this.#risk,
        market: this.#market,
        quotes,
        canTrade: this.#canTrade(),
        now,
      });
      const fills = matched.fills.filter((entry) => tracked.has(entry.fill.id));
      const canceled = matched.canceled.filter((order) => tracked.has(order.id));
      const expired = matched.expired.filter((order) => tracked.has(order.id));
      const failures = matched.failures.filter((entry) => tracked.has(entry.orderId));
      this.#state.workingOrderIds = matched.open.filter((order) => tracked.has(order.id)).map((order) => order.id);

      for (const entry of fills) {
        this.#audit("AUTO_ORDER_FILLED", {
          symbol: this.#symbol,
          strategyId: this.#strategy.id,
          orderId: entry.fill.id,
          side: entry.fill.side,
          qty: entry.fill.filledQty ?? entry.fill.qty,
          price: entry.fill.fillPrice ?? entry.fill.price,
          fee: entry.fill.fee,
          matching: entry.match,
        });
      }
      for (const order of expired) this.#audit("AUTO_ORDER_EXPIRED", { symbol: this.#symbol, strategyId: this.#strategy.id, orderId: order.id });
      for (const order of canceled) this.#audit("AUTO_ORDER_CANCELED", { symbol: this.#symbol, strategyId: this.#strategy.id, orderId: order.id });

      const reconciliationFailure = failures.find((entry) => entry.decision?.code === "RECONCILIATION_FAILED");
      if (reconciliationFailure || this.#risk.isTripped?.()) {
        this.#tripLifecycle(reconciliationFailure ? "RECONCILIATION_FAILED" : "KILL_SWITCH_ACTIVE");
        return { ok: false, code: reconciliationFailure ? "RECONCILIATION_FAILED" : "KILL_SWITCH", matched, status: this.status() };
      }
      if (this.#state.workingOrderIds.length) {
        this.#state.lastOutcome = "ORDER_WORKING";
        this.#save();
        return { ok: true, code: "ORDER_WORKING", matched, status: this.status() };
      }
      if (fills.length) {
        this.#state.lastExecution = {
          executedAt: new Date(now).toISOString(),
          fillIds: fills.map((entry) => entry.fill.id),
        };
        this.#state.lastOutcome = "EXECUTED";
        this.#save();
        return { ok: true, code: "EXECUTED", fills: fills.map((entry) => entry.fill), matched, status: this.status() };
      }
      if (expired.length || canceled.length || failures.length) {
        this.#state.lastOutcome = expired.length ? "ORDER_EXPIRED" : "ORDER_CANCELED";
        this.#save();
        return { ok: false, code: this.#state.lastOutcome, matched, status: this.status() };
      }
    }

    const completed = latestCompletedTwBar(bars, now);
    if (!completed || completed.index < this.#strategy.warmup) {
      this.#state.lastOutcome = "INSUFFICIENT_COMPLETED_BARS";
      this.#save();
      return { ok: false, code: "INSUFFICIENT_COMPLETED_BARS", status: this.status() };
    }

    const account = this.#broker.snapshot(this.#market, quotes);
    if (this.#state.lastEvaluatedBar !== completed.bar.t) {
      const history = bars.slice(0, completed.index + 1);
      const raw = this.#strategy.generateSignal({ bars: history, index: completed.index, symbol: this.#symbol });
      const signal = normalizeSignal(raw, { symbol: this.#symbol, timestamp: completed.bar.t });
      const currentBinary = account.positions[this.#symbol]?.qty > 0 ? 1 : 0;
      const targetBinary = signalToTargetWeight(signal, currentBinary);
      this.#state.lastEvaluatedBar = completed.bar.t;
      this.#state.pendingIntent = targetBinary === currentBinary ? null : {
        signalBarTimestamp: completed.bar.t,
        targetBinary,
        signal: {
          score: signal.score,
          confidence: signal.confidence,
          horizon: signal.horizon,
          reasonCodes: signal.reasonCodes,
          diagnostics: signal.diagnostics,
        },
      };
      this.#state.lastOutcome = this.#state.pendingIntent ? "INTENT_QUEUED" : "NO_TARGET_CHANGE";
      this.#save();
      this.#audit("AUTO_SIGNAL_EVALUATED", {
        symbol: this.#symbol,
        strategyId: this.#strategy.id,
        barTimestamp: completed.bar.t,
        score: signal.score,
        confidence: signal.confidence,
        targetBinary,
        queued: Boolean(this.#state.pendingIntent),
      });
    }

    if (!this.#state.pendingIntent) return { ok: true, code: "NO_TARGET_CHANGE", status: this.status() };

    const currentSession = getCurrentSession(this.#market, now);
    const signalSessionKey = this.#sessionClock.sessionKey(this.#market, new Date(this.#state.pendingIntent.signalBarTimestamp).toISOString());
    const executionSessionKey = this.#sessionClock.sessionKey(this.#market, new Date(now).toISOString());
    if (!currentSession || signalSessionKey === executionSessionKey) {
      return { ok: true, code: "WAIT_NEXT_SESSION", status: this.status() };
    }
    if (!quoteIsFresh(quoteEnvelope)) {
      this.#state.lastOutcome = "STALE_QUOTE_BLOCKED";
      this.#save();
      this.#audit("AUTO_EXECUTION_BLOCKED", { symbol: this.#symbol, code: "STALE_QUOTE" });
      return { ok: false, code: "STALE_QUOTE", status: this.status() };
    }

    return this.#executePending({ quoteEnvelope, now });
  }

  #executePending({ quoteEnvelope, now }) {
    const quote = quoteEnvelope.data;
    const quotes = quoteMap(this.#symbol, quote);
    const account = this.#broker.snapshot(this.#market, quotes);
    const intent = this.#state.pendingIntent;
    const currentQty = account.positions[this.#symbol]?.qty ?? 0;
    let desiredQty = 0;
    if (intent.targetBinary === 1) {
      const fraction = finiteFraction(this.#allocate({
        signal: intent.signal,
        account,
        market: this.#market,
        symbol: this.#symbol,
      }));
      desiredQty = Math.max(0, Math.floor((account.equity * fraction) / quote.price));
    }
    const delta = desiredQty - currentQty;
    if (delta === 0) {
      this.#state.pendingIntent = null;
      this.#state.lastOutcome = "TARGET_ALREADY_MET";
      this.#save();
      return { ok: true, code: "TARGET_ALREADY_MET", status: this.status() };
    }

    const chunks = splitDelta(this.#market, delta);
    const workingOrders = [];
    const fills = [];
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const order = buildOrderCandidate({
        market: this.#market,
        symbol: this.#symbol,
        side: chunk.side,
        qty: chunk.qty,
        price: quote.price,
        lot: chunk.lot,
        quote,
        orderType: "limit",
        timeInForce: "DAY",
        executionMode: ExecutionMode.MATCHING,
        clientOrderId: `auto:${this.#strategy.id}:${this.#symbol}:${intent.signalBarTimestamp}:${chunk.side}:${chunk.lot}:${index}`,
      });
      const result = executePaperOrder({
        broker: this.#broker,
        risk: this.#risk,
        order,
        quotes,
        canTrade: this.#canTrade(),
        now,
      });
      if (!result.accepted) {
        for (const working of workingOrders) {
          const current = this.#broker.findOrderById(this.#market, working.id);
          if (current?.status === "OPEN") this.#broker.cancelOrder(this.#market, working.id, { reason: "sibling order rejected" });
        }
        this.#state.workingOrderIds = [];
        this.#state.lastOutcome = `EXECUTION_REJECTED:${result.decision.code}`;
        this.#save();
        this.#audit("AUTO_ORDER_REJECTED", {
          symbol: this.#symbol,
          strategyId: this.#strategy.id,
          code: result.decision.code,
          reason: result.decision.reason,
        });
        return { ok: false, code: result.decision.code, decision: result.decision, status: this.status() };
      }

      if (result.filled) {
        fills.push(result.fill);
        continue;
      }
      if (result.order?.status === "OPEN") {
        workingOrders.push(result.order);
        this.#audit("AUTO_ORDER_OPEN", {
          symbol: this.#symbol,
          strategyId: this.#strategy.id,
          orderId: result.order.id,
          side: result.order.side,
          qty: result.order.qty,
          limitPrice: result.order.price,
          timeInForce: result.order.timeInForce,
        });
      }
    }

    this.#state.pendingIntent = null;
    this.#state.workingOrderIds = workingOrders.map((order) => order.id);
    if (this.#state.workingOrderIds.length) {
      this.#state.lastOutcome = "ORDER_WORKING";
      this.#save();
      return { ok: true, code: "ORDER_WORKING", orders: workingOrders, fills, status: this.status() };
    }

    this.#state.lastExecution = {
      signalBarTimestamp: intent.signalBarTimestamp,
      executedAt: new Date(now).toISOString(),
      fillIds: fills.map((fill) => fill.id),
    };
    this.#state.lastOutcome = "EXECUTED";
    this.#save();
    return { ok: true, code: "EXECUTED", fills, status: this.status() };
  }

  #cancelWorking(reason) {
    for (const orderId of this.#state.workingOrderIds ?? []) {
      try {
        const current = this.#broker.findOrderById(this.#market, orderId);
        if (current?.status === "OPEN") this.#broker.cancelOrder(this.#market, orderId, { reason });
      } catch {
        // Safety stop remains fail-closed even if cleanup cannot mutate a corrupt order.
      }
    }
    this.#state.workingOrderIds = [];
  }

  #tripLifecycle(reason) {
    this.#cancelWorking(`trip:${reason}`);
    if (this.#state.lifecycle === LIFECYCLE.PAPER_ENABLED) {
      this.#state.lifecycle = transitionLifecycle(this.#state.lifecycle, LIFECYCLE.KILL_SWITCHED);
    }
    this.#state.pendingIntent = null;
    this.#state.lastOutcome = reason;
    this.#save();
  }
}

export { latestCompletedTwBar, quoteIsFresh, splitDelta };
