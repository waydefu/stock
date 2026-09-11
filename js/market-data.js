/* 行情資料入口（port）：UI 與回測只跟 adapter 要資料，不直連產生器。
   目前唯一實作是 SimulatedAdapter（本機種子模擬，可重現）。
   Legacy 形狀（getBars／quote／getSource）凍結不變，回歸測試鎖住；
   新契約（capabilities／status／envelopes／describe）走 provider-neutral
   shapes，定義見 js/market-data-contract.js。
   live adapter 額外責任（本檔不實作，只定契約）：
     stale／缺棒／重複棒处理、時區轉換、provider 時間戳與本地收到時間戳並存、
     HTTP 429／timeout 的 retry＋backoff＋cache、來源標示。 */
"use strict";

import { getBars as simulatedBars, getSymbol, quote as simulatedQuote } from "./data.js";
import { ORDER_ERROR_CODE, OrderError } from "./order-errors.js";
import {
  DATA_KINDS,
  NORMALIZATION_VERSION,
  classifyBars,
  describeCapability,
  normalizeBars,
  normalizeQuote,
  wrapEnvelope,
} from "./market-data-contract.js";

const SIMULATED_CAPABILITY = {
  provider: "SIMULATED",
  markets: ["TW", "US"],
  capabilities: {
    quote: true,
    historicalBars: true,
    realtimeStream: false,
    snapshot: true,
    corporateActions: false,
    fundamentals: false,
  },
  dataKinds: [DATA_KINDS.SIMULATION],
  transport: "local",
  auth: "none",
};

export class SimulatedAdapter {
  #source;
  #clock;

  constructor({ clock = () => Date.now() } = {}) {
    this.#clock = clock;
    this.#source = Object.freeze({
      name: "本機模擬行情",
      shortLabel: "模擬行情",
      kind: "simulation",
      note: "種子可重現，非即時，不能代表真實市場",
      updatedAt: "2025-12-31（固定模擬終點）",
    });
  }

  getSource() {
    return this.#source;
  }

  getBars(symbol) {
    if (!getSymbol(symbol)) throw new OrderError(ORDER_ERROR_CODE.INVALID_SYMBOL, `未知標的：${symbol}`);
    return simulatedBars(symbol);
  }

  quote(symbol) {
    if (!getSymbol(symbol)) throw new OrderError(ORDER_ERROR_CODE.INVALID_SYMBOL, `未知標的：${symbol}`);
    return simulatedQuote(symbol);
  }

  getCapabilities() {
    return describeCapability(SIMULATED_CAPABILITY);
  }

  getStatus() {
    return { state: "READY", detail: "本機確定性產生器，無傳輸故障模式", since: null };
  }

  /* Machine-readable identity: UI 與 research 拿 dataKind／status，不再只靠中文字判斷。 */
  describe({ now = this.#clock() } = {}) {
    const receivedAt = now;
    return Object.freeze({
      provider: "SIMULATED",
      dataKind: DATA_KINDS.SIMULATION,
      status: this.getStatus().state,
      pointInTime: "unknown",
      adjustmentMode: "unknown",
      normalizationVersion: NORMALIZATION_VERSION,
      receivedAt,
    });
  }

  quoteEnvelope(symbol, { receivedAt = this.#clock(), now = receivedAt } = {}) {
    const meta = getSymbol(symbol);
    if (!meta) throw new OrderError(ORDER_ERROR_CODE.INVALID_SYMBOL, `未知標的：${symbol}`);
    const normalized = normalizeQuote(this.quote(symbol), { market: meta.market });
    return wrapEnvelope(normalized, {
      provider: "SIMULATED", market: meta.market, symbol, dataKind: DATA_KINDS.SIMULATION,
      providerTimestamp: null, receivedAt, source: "local-generator", now,
    });
  }

  getBarsEnvelope(symbol, { receivedAt = this.#clock(), now = receivedAt } = {}) {
    if (!getSymbol(symbol)) throw new OrderError(ORDER_ERROR_CODE.INVALID_SYMBOL, `未知標的：${symbol}`);
    const normalized = normalizeBars(this.getBars(symbol));
    const envelope = wrapEnvelope(normalized, {
      provider: "SIMULATED", market: getSymbol(symbol).market, symbol, dataKind: DATA_KINDS.SIMULATION,
      providerTimestamp: null, receivedAt, source: "local-generator", now,
    });
    return { envelope, issues: classifyBars([...normalized]) };
  }
}
