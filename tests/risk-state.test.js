/* Track B3：狀態與引擎（R-027／R-030／R-031、F-11／F-13）。
   這裡鎖住的是「行為」，不是實作細節：
   - 手動斷路器要跨 reload 存活（versioned localStorage）；
   - 日損分母是 session 開盤 equity，不是當下 equity；
   - risk-free 是年化利率，超額報酬用每期利率；
   - 研究引擎的 target 必須反映「真的成交」。 */
import assert from "node:assert/strict";
import test from "node:test";
import { RiskEngine } from "../js/risk.js";
import { perPeriodRate } from "../js/accounting.js";
import { evaluateWindow, summarizeResearch } from "../js/research.js";
import { startStaleProbe } from "../server/start-market-proxy.js";

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    get size() { return map.size; },
    raw: map,
  };
}

test("手動斷路器在 reload 後仍維持凍結", () => {
  const storage = memoryStorage();
  const first = new RiskEngine({}, { storage });
  assert.equal(first.isTripped(), false);
  first.trip("風控官手動凍結");
  assert.equal(first.isTripped(), true);

  const reloaded = new RiskEngine({}, { storage });
  assert.equal(reloaded.isTripped(), true, "重新載入後仍應凍結");
  assert.match(reloaded.status().reason, /風控官手動凍結/);
  assert.equal(reloaded.status().persisted, true);

  reloaded.reset();
  assert.equal(reloaded.isTripped(), false);
  assert.equal(new RiskEngine({}, { storage }).isTripped(), false, "reset 後 reload 不應再凍結");
});

test("斷路器持久化資料毀損或版本未知時安全回到未啟動", () => {
  const broken = memoryStorage({ "tw-us-stock-killswitch-v1": "{not json" });
  assert.equal(new RiskEngine({}, { storage: broken }).isTripped(), false);
  const future = memoryStorage({ "tw-us-stock-killswitch-v1": JSON.stringify({ version: 99, tripped: true }) });
  assert.equal(new RiskEngine({}, { storage: future }).isTripped(), false);
});

test("日損斷路器用 session 開盤 equity 當分母", () => {
  const risk = new RiskEngine({ maxDailyLossPct: 0.02 });
  const account = { equity: 900_000, dailyPnl: -18_000, dailyLossReferenceEquity: 1_000_000, cash: 900_000, positions: {} };
  const order = { market: "US", symbol: "AAPL", side: "buy", qty: 1, price: 100, orderType: "limit" };
  // 以當下 equity 分母：18000/900000 = 2% → 會觸發；以 session 開盤 equity：1.8% → 不觸發。
  const decision = risk.approveOrder(account, order, { now: Date.now() });
  assert.equal(decision.ok, true, `應以 session 開盤 equity 計算：${decision.reason ?? ""}`);
  assert.equal(risk.isTripped(), false);

  const worse = { ...account, dailyPnl: -25_000 };
  const tripped = risk.approveOrder(worse, order, { now: Date.now() });
  assert.equal(tripped.ok, false);
  assert.equal(tripped.code, "DAILY_LOSS_LIMIT");
});

test("risk-free 年化利率會折算成每期利率", () => {
  const daily = perPeriodRate(0.03, 252);
  assert.ok(daily > 0 && daily < 0.03 / 252 * 1.01, `每期利率應遠小於年化：${daily}`);
  assert.ok(Math.abs(perPeriodRate(0.03, 252) - (Math.pow(1.03, 1 / 252) - 1)) < 1e-12);
  assert.equal(perPeriodRate(0.03, 1), 0.03, "periodsPerYear = 1 時視為已是每期值");
  assert.throws(() => perPeriodRate(0.03, 0), /periodsPerYear/);
});

test("研究引擎的 target 反映實際成交：配置回 0 時不得假稱持有", () => {
  const bars = Array.from({ length: 40 }, (_, i) => ({ t: i + 1, o: 100, h: 101, l: 99, c: 100, v: 1 }));
  const strategy = {
    id: "test-long",
    name: "Test Long",
    version: "1.0.0",
    hypothesis: "測試用：永遠發出 long 訊號。",
    requiredData: ["ohlcv:daily"],
    warmup: 5,
    parameters: {},
    generateSignal: () => ({ score: 1, confidence: 1, horizon: "none", reasonCodes: ["TEST"], diagnostics: {} }),
  };
  const result = evaluateWindow({
    symbol: "2330",
    strategy,
    allocate: () => 0, // 配置 0：永遠買不成
    contextBars: bars.slice(0, 10),
    evalBars: bars.slice(10),
    commissionRate: 0,
    slippageBps: 0,
  });
  assert.equal(result.trades.length, 0);
  // 沒有任何成交 → 曝險應為 0，且不應累積出「以為持有」的目標。
  assert.equal(result.equity.at(-1), result.equity[0]);
  const summary = summarizeResearch(result, { periodsPerYear: 252 });
  assert.equal(summary.tradeCount, 0);
  assert.equal(summary.avgExposure, 0);
});

test("entrypoint 的 stale probe 可排程且可停止", () => {
  const calls = [];
  let scheduled = null;
  let cleared = null;
  const probe = startStaleProbe({ probeStale: () => calls.push("probe") }, {
    intervalMs: 1_000,
    setIntervalImpl: (fn, ms) => { scheduled = { fn, ms }; return { unref() {} }; },
    clearIntervalImpl: (handle) => { cleared = handle; },
  });
  assert.ok(scheduled, "應已排程");
  assert.equal(scheduled.ms, 1_000);
  scheduled.fn();
  assert.equal(calls.length, 1);
  probe.stop();
  assert.ok(cleared, "stop 應清除排程");
});

test("stale probe 失敗不會讓 proxy 主流程中斷", () => {
  let scheduled = null;
  startStaleProbe({ probeStale: () => { throw new Error("boom"); } }, {
    intervalMs: 1_000,
    setIntervalImpl: (fn) => { scheduled = fn; return { unref() {} }; },
    clearIntervalImpl: () => {},
  });
  assert.doesNotThrow(() => scheduled());
});

test("台股零股市價單被拒（零股只收限價），整股市價單不受影響", () => {
  const risk = new RiskEngine();
  const account = { equity: 1_000_000, cash: 1_000_000, positions: {}, dailyPnl: 0, dailyLossReferenceEquity: 1_000_000 };
  const base = { market: "TW", symbol: "2330", side: "buy", qty: 10, price: 100, referencePrice: 100, orderType: "market" };
  const TAIPEI_SESSION = Date.parse("2026-09-15T02:00:00Z");

  const oddLot = risk.approveOrder(account, { ...base, lot: "oddLot" }, { now: TAIPEI_SESSION });
  assert.equal(oddLot.ok, false);
  assert.equal(oddLot.code, "ODD_LOT_LIMIT_ONLY");

  const regular = risk.approveOrder(account, { ...base, qty: 1000, lot: "regular" }, { now: TAIPEI_SESSION });
  assert.equal(regular.ok, true, `整股市價單應可預覽：${regular.reason ?? ""}`);

  const noLot = risk.approveOrder(account, { ...base }, { now: TAIPEI_SESSION });
  assert.equal(noLot.ok, true, "未指定 lot 時維持相容語意（不套用零股限制）");
});
