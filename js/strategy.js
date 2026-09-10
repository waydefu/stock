/* Strategy / Signal research contract（Slice C）。
   靈感來自 QuantConnect Algorithm Framework 的分層思想（Universe／Alpha／
   Portfolio Construction／Execution／Risk Management 各自獨立、可互換；
   見 docs/RESEARCH_LEDGER.md），但本檔只取「分層＋可互換」的工程概念，
   不依賴其任何程式碼或 API。

   分層語義（long-only prototype，不做裸放空）：
   - Alpha 回答「應該持有什麼、方向與強度」→ 輸出 Signal（score -1..+1）。
   - Portfolio 回答「分配多少資金／風險」→ 把 Signal 轉成 target exposure。
   - Execution 回答「如何把 target 轉成 order」→ 仍走 next-bar-open 立即紙上成交。
   - 負 score 在 long-only 下代表 reduce／exit／avoid，不代表 short。

   Signal 標準形：
     { symbol, timestamp, score, confidence, horizon, reasonCodes, diagnostics }
*/
"use strict";

export const SIGNAL_VERSION = 1;

/** 策略生命週期：新策略不得自動進 paper，必須走 promotion gate。 */
export const LIFECYCLE = Object.freeze({
  DRAFT: "DRAFT",
  BACKTESTED: "BACKTESTED",
  RESEARCH_APPROVED: "RESEARCH_APPROVED",
  PAPER_ENABLED: "PAPER_ENABLED",
  PAUSED: "PAUSED",
  KILL_SWITCHED: "KILL_SWITCHED",
  RETIRED: "RETIRED",
});

/** 允許的生命週期轉換；不在表內一律拒絕。 */
const LIFECYCLE_TRANSITIONS = {
  [LIFECYCLE.DRAFT]: [LIFECYCLE.BACKTESTED, LIFECYCLE.RETIRED],
  [LIFECYCLE.BACKTESTED]: [LIFECYCLE.RESEARCH_APPROVED, LIFECYCLE.DRAFT, LIFECYCLE.RETIRED],
  [LIFECYCLE.RESEARCH_APPROVED]: [LIFECYCLE.PAPER_ENABLED, LIFECYCLE.PAUSED, LIFECYCLE.RETIRED],
  [LIFECYCLE.PAPER_ENABLED]: [LIFECYCLE.PAUSED, LIFECYCLE.KILL_SWITCHED, LIFECYCLE.RETIRED],
  [LIFECYCLE.PAUSED]: [LIFECYCLE.RESEARCH_APPROVED, LIFECYCLE.RETIRED],
  [LIFECYCLE.KILL_SWITCHED]: [LIFECYCLE.PAUSED, LIFECYCLE.RETIRED],
  [LIFECYCLE.RETIRED]: [],
};

export function transitionLifecycle(from, to) {
  const allowed = LIFECYCLE_TRANSITIONS[from];
  if (!allowed) throw new Error(`unknown lifecycle state: ${from}`);
  if (!allowed.includes(to)) throw new Error(`illegal lifecycle transition: ${from} → ${to}`);
  return to;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const REQUIRED_STRATEGY_FIELDS = ["id", "name", "version", "hypothesis", "requiredData", "warmup", "parameters", "generateSignal"];

/** 驗證 Strategy 定義；缺欄位或型別錯誤直接丟錯，不猜。 */
export function validateStrategy(def) {
  if (!isPlainObject(def)) throw new Error("strategy definition 必須是物件");
  for (const field of REQUIRED_STRATEGY_FIELDS) {
    if (def[field] === undefined || def[field] === null || def[field] === "") {
      throw new Error(`strategy 缺少必要欄位：${field}`);
    }
  }
  if (typeof def.id !== "string") throw new Error("strategy.id 必須是字串");
  if (typeof def.generateSignal !== "function") throw new Error("strategy.generateSignal 必須是函數");
  if (!Number.isInteger(def.warmup) || def.warmup < 0) throw new Error("strategy.warmup 必須是非負整數（bar 數）");
  if (!Array.isArray(def.requiredData)) throw new Error("strategy.requiredData 必須是陣列");
  if (!isPlainObject(def.parameters)) throw new Error("strategy.parameters 必須是物件");
  return true;
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** 把 generateSignal 回傳值正規化為 Signal 標準形；不合法直接丟錯。 */
export function normalizeSignal(raw, { symbol, timestamp }) {
  if (!isPlainObject(raw)) throw new Error("signal 必須是物件");
  if (typeof symbol !== "string" || !symbol) throw new Error("signal 需要 symbol");
  if (!Number.isFinite(timestamp)) throw new Error("signal 需要有限數值 timestamp");
  return Object.freeze({
    version: SIGNAL_VERSION,
    symbol,
    timestamp,
    score: clamp(raw.score, -1, 1, 0),
    confidence: clamp(raw.confidence, 0, 1, 0),
    horizon: typeof raw.horizon === "string" && raw.horizon ? raw.horizon : "unspecified",
    reasonCodes: Array.isArray(raw.reasonCodes) ? raw.reasonCodes.filter((c) => typeof c === "string") : [],
    diagnostics: isPlainObject(raw.diagnostics) ? raw.diagnostics : {},
  });
}

/**
 * long-only 目標倉位映射（不做裸放空）：
 *   score >= entryThreshold → 1（持有）
 *   score <= exitThreshold  → 0（reduce／exit／avoid）
 *   其餘 → 維持前值（null 代表無前值時維持 0）
 */
export function signalToTargetWeight(signal, previousWeight, { entryThreshold = 0.5, exitThreshold = -0.5 } = {}) {
  const prev = previousWeight === 1 ? 1 : 0;
  if (signal.score >= entryThreshold) return 1;
  if (signal.score <= exitThreshold) return 0;
  return prev;
}

/** 策略註冊表：研究基準庫與新策略的唯一入口。 */
export class StrategyRegistry {
  #strategies = new Map();

  register(def) {
    validateStrategy(def);
    if (this.#strategies.has(def.id)) throw new Error(`strategy id 重複：${def.id}`);
    this.#strategies.set(def.id, Object.freeze({ ...def }));
    return def.id;
  }

  get(id) {
    const def = this.#strategies.get(id);
    if (!def) throw new Error(`unknown strategy: ${id}`);
    return def;
  }

  list() {
    return [...this.#strategies.values()].map((d) => ({
      id: d.id,
      name: d.name,
      version: d.version,
      hypothesis: d.hypothesis,
      warmup: d.warmup,
    }));
  }

  get size() {
    return this.#strategies.size;
  }
}
