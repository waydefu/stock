/* 行情資料入口（port）：UI 與回測只跟 adapter 要資料，不直連產生器。
   目前唯一實作是 SimulatedAdapter（本機種子模擬，可重現）。
   未來 live adapter（Fugle／Shioaji／Alpaca）只要實作同介面即可替換：
     - getBars(symbol) -> Array<{t,o,h,l,c,v}>（t 為 ms 時間戳，嚴格遞增）
     - quote(symbol) -> {code, price, prev, chg, pct, vol}
     - getSource() -> {name, kind: 'simulation'|'delayed'|'realtime', note, updatedAt}
   live adapter 額外責任（本檔不實作，只定契約）：
     stale／缺棒／重複棒处理、時區轉換、provider 時間戳與本地收到時間戳並存、
     HTTP 429／timeout 的 retry＋backoff＋cache、來源標示。 */
"use strict";

import { getBars as simulatedBars, getSymbol, quote as simulatedQuote } from "./data.js";
import { ORDER_ERROR_CODE, OrderError } from "./order-errors.js";

export class SimulatedAdapter {
  #source;

  constructor() {
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
}
