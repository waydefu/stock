import assert from "node:assert/strict";
import test from "node:test";
import { MemoryStorage, PaperBroker } from "../js/paper.js";
import { createAccountSnapshot, assertAccountingInvariants } from "../js/accounting.js";
import {
  createTwFeeModel,
  describeTwFeeModel,
  scaleTwFeeModel,
  DEFAULT_TW_FEE_ASSUMPTIONS,
  TW_INSTRUMENT,
} from "../js/tw-fee-model.js";
import { runBacktest } from "../js/backtest.js";
import { evaluateWindow, summarizeResearch } from "../js/research.js";
import { BUY_HOLD_STRATEGY } from "../js/alpha.js";
import { fullNotional } from "../js/portfolio.js";

test("FeeModel pluggability: fixed-percent fee model produces fees and preserves invariants", () => {
  const FIXED_PERCENT_FEE_MODEL = Object.freeze({
    name: "fixed-percent-0.1425",
    calculate: (ctx) => ctx.notional * 0.001425,
  });

  const broker = new PaperBroker({
    storage: new MemoryStorage(),
    now: () => "2025-01-02T09:00:00.000Z",
    feeModel: FIXED_PERCENT_FEE_MODEL,
  });

  // Buy 100 shares @ 100
  const buyOrder = broker.placeOrder({
    market: "TW",
    symbol: "2330",
    side: "buy",
    qty: 100,
    price: 100,
    clientOrderId: "fee-test-buy",
  });

  // Verify buy order has fee
  const buyFee = buyOrder.fee;
  assert.ok(buyFee > 0, `buy fee should be > 0, got ${buyFee}`);
  assert.equal(buyFee, 100 * 100 * 0.001425);

  // Sell 100 shares @ 120
  const sellOrder = broker.placeOrder({
    market: "TW",
    symbol: "2330",
    side: "sell",
    qty: 100,
    price: 120,
    clientOrderId: "fee-test-sell",
  });

  // Verify sell order has fee
  const sellFee = sellOrder.fee;
  assert.ok(sellFee > 0, `sell fee should be > 0, got ${sellFee}`);
  assert.equal(sellFee, 120 * 100 * 0.001425);

  // Snapshot with quotes
  const snapshot = broker.snapshot("TW", { "2330": { price: 120 } });

  // Total fees should be sum of both
  const expectedTotalFees = buyFee + sellFee;
  assert.equal(snapshot.totalFees, expectedTotalFees, `totalFees should be ${expectedTotalFees}, got ${snapshot.totalFees}`);
  assert.ok(snapshot.totalFees > 0, "totalFees should be > 0");

  // Fee model recorded correctly
  assert.equal(snapshot.feeModel, "fixed-percent-0.1425");

  // Accounting invariants must hold
  assertAccountingInvariants(snapshot);

  // Verify specific invariants
  assert.equal(snapshot.equity, snapshot.cash + snapshot.marketValue);
  assert.equal(snapshot.totalPnl, snapshot.realizedPnl + snapshot.unrealizedPnl);
  assert.ok(snapshot.cash >= 0);
  assert.ok(snapshot.marketValue >= 0);
  assert.ok(Number.isFinite(snapshot.equity));

  // Verify cash math: initial 1,000,000 - buy_cost - buy_fee + sell_proceeds - sell_fee
  const buyCost = 100 * 100;
  const sellProceeds = 120 * 100;
  const expectedCash = 1_000_000 - buyCost - buyFee + sellProceeds - sellFee;
  assert.equal(snapshot.cash, expectedCash, `cash should be ${expectedCash}, got ${snapshot.cash}`);

  // Verify realized PnL: (120 - 100) * 100 - buyFee - sellFee = 2000 - fees
  const expectedRealized = (120 - 100) * 100 - buyFee - sellFee;
  const realizedDiff = Math.abs(snapshot.realizedPnl - expectedRealized);
  assert.ok(realizedDiff < 1e-10, `realizedPnl should be ${expectedRealized}, got ${snapshot.realizedPnl}`);
});

test("FeeModel pluggability: zero-fee-paper default unchanged", () => {
  const broker = new PaperBroker({
    storage: new MemoryStorage(),
    now: () => "2025-01-02T09:00:00.000Z",
  });

  broker.placeOrder({
    market: "TW",
    symbol: "2330",
    side: "buy",
    qty: 100,
    price: 100,
    clientOrderId: "default-buy",
  });

  broker.placeOrder({
    market: "TW",
    symbol: "2330",
    side: "sell",
    qty: 100,
    price: 120,
    clientOrderId: "default-sell",
  });

  const snapshot = broker.snapshot("TW", { "2330": { price: 120 } });

  // Default must remain zero-fee-paper with zero fees
  assert.equal(snapshot.feeModel, "zero-fee-paper");
  assert.equal(snapshot.totalFees, 0);

  // Invariants hold
  assertAccountingInvariants(snapshot);
});

test("FeeModel pluggability: custom fee model validates negative fees rejected at order placement", () => {
  const INVALID_FEE_MODEL = Object.freeze({
    name: "invalid-negative",
    calculate: () => -100,
  });

  const broker = new PaperBroker({
    storage: new MemoryStorage(),
    now: () => "2025-01-02T09:00:00.000Z",
    feeModel: INVALID_FEE_MODEL,
  });

  assert.throws(
    () => broker.placeOrder({
      market: "TW",
      symbol: "2330",
      side: "buy",
      qty: 100,
      price: 100,
      clientOrderId: "fee-test-invalid",
    }),
    /FeeModel 回傳無效費用/
  );
});

test("FeeModel pluggability: custom fee model validates non-function calculate rejected at order placement", () => {
  const INVALID_FEE_MODEL = Object.freeze({
    name: "invalid-no-calculate",
    calculate: "not a function",
  });

  const broker = new PaperBroker({
    storage: new MemoryStorage(),
    now: () => "2025-01-02T09:00:00.000Z",
    feeModel: INVALID_FEE_MODEL,
  });

  assert.throws(
    () => broker.placeOrder({
      market: "TW",
      symbol: "2330",
      side: "buy",
      qty: 100,
      price: 100,
      clientOrderId: "fee-test-invalid2",
    }),
    /FeeModel 必須提供 calculate/
  );
});

/* ── 台股成本模型（回測／研究用）────────────────────────────────────────────
   稅率與手續費依據見 js/accounting.js 註解與 RESEARCH_LEDGER 本輪條目：
   《證券交易稅條例》第 2 條（股票千分之三／其他經政府核准之有價證券千分之一）、
   第 2-2 條（上市或上櫃股票當日沖銷千分之一點五）、
   臺灣證券交易所營業細則第 94 條（折讓與每筆最低費用由經紀商自訂並報備查）。 */

const STOCK_MODEL = () => createTwFeeModel();

test("TW FeeModel：股票買入只有手續費（0.1425%，無證券交易稅）", () => {
  const model = STOCK_MODEL();
  const fee = model.calculate({ side: "buy", price: 100, qty: 1000 });
  assert.equal(fee, 142.5);
  const detail = model.breakdown({ side: "buy", price: 100, qty: 1000 });
  assert.equal(detail.commission, 142.5);
  assert.equal(detail.tax, 0);
  assert.equal(detail.notional, 100_000);
});

test("TW FeeModel：股票賣出＝手續費＋0.3% 證券交易稅（稅基是成交金額）", () => {
  const model = STOCK_MODEL();
  const detail = model.breakdown({ side: "sell", price: 100, qty: 1000 });
  assert.equal(detail.commission, 142.5);
  assert.equal(detail.tax, 300);
  assert.equal(detail.total, 442.5);
  assert.equal(model.calculate({ side: "sell", price: 100, qty: 1000 }), 442.5);
});

test("TW FeeModel：ETF／受益憑證賣出只課 0.1% 證券交易稅", () => {
  const model = STOCK_MODEL();
  for (const instrumentType of [TW_INSTRUMENT.ETF, TW_INSTRUMENT.WARRANT]) {
    const detail = model.breakdown({ side: "sell", price: 100, qty: 1000, instrumentType });
    assert.equal(detail.tax, 100, `${instrumentType} 稅額`);
    assert.equal(detail.total, 242.5, `${instrumentType} 合計`);
  }
});

test("TW FeeModel：單筆最低手續費生效（小額委託以 20 元計收）", () => {
  const model = STOCK_MODEL();
  const buy = model.breakdown({ side: "buy", price: 10, qty: 1 });
  assert.equal(buy.notional, 10);
  assert.equal(buy.commission, 20);
  assert.equal(buy.total, 20);
  const sell = model.breakdown({ side: "sell", price: 10, qty: 1 });
  assert.equal(sell.commission, 20);
  assert.equal(sell.tax, 0.03);
});

test("TW FeeModel：折讓是「減收比例」，費率上限 × (1 − discount)", () => {
  // 減收 28%：費率上限 0.3% → 有效 0.216%
  const discounted = createTwFeeModel({ commissionRate: 0.003, commissionDiscount: 0.28 });
  assert.equal(discounted.assumptions.effectiveCommissionRate, 0.00216);
  assert.equal(discounted.calculate({ side: "buy", price: 100, qty: 1000 }), 216);

  // 市場俗稱「幾折」＝付幾成：28 折（付 28%）＝ 減收 72%
  const twentyEightFold = createTwFeeModel({ commissionRate: 0.001425, commissionDiscount: 0.72 });
  assert.ok(Math.abs(twentyEightFold.assumptions.effectiveCommissionRate - 0.000399) < 1e-12);
  assert.ok(Math.abs(twentyEightFold.calculate({ side: "buy", price: 100, qty: 1000 }) - 39.9) < 1e-9);

  // 不折讓時就是市場標準費率 0.1425%
  const standard = createTwFeeModel({ commissionDiscount: 0 });
  assert.equal(standard.assumptions.effectiveCommissionRate, 0.001425);
});

test("TW FeeModel：當日沖銷股票稅率 0.15%，ETF 不適用（仍用 0.1%）", () => {
  const model = STOCK_MODEL();
  const stockDayTrade = model.breakdown({ side: "sell", price: 100, qty: 1000, dayTrade: true });
  assert.equal(stockDayTrade.tax, 150);
  assert.equal(stockDayTrade.total, 292.5);
  const etfDayTrade = model.breakdown({ side: "sell", price: 100, qty: 1000, dayTrade: true, instrumentType: TW_INSTRUMENT.ETF });
  assert.equal(etfDayTrade.tax, 100);
  // 買方不論是否當沖都不繳證交稅
  assert.equal(model.calculate({ side: "buy", price: 100, qty: 1000, dayTrade: true }), 142.5);
});

test("TW FeeModel：邊界（qty 0／price 0 → 0；負數與缺欄位 → 明確錯誤）", () => {
  const model = STOCK_MODEL();
  assert.equal(model.calculate({ side: "buy", price: 100, qty: 0 }), 0);
  assert.equal(model.calculate({ side: "sell", price: 0, qty: 100 }), 0);
  assert.throws(() => model.calculate({ side: "buy", price: 100, qty: -1 }), /qty/);
  assert.throws(() => model.calculate({ side: "buy", price: -100, qty: 1 }), /price/);
  assert.throws(() => model.calculate({ price: 100, qty: 1 }), /side/);
  assert.throws(() => model.calculate({ side: "hold", price: 100, qty: 1 }), /side/);
  assert.throws(() => model.calculate({ side: "buy", price: 100, qty: 1, instrumentType: "bond" }), /商品別/);
  assert.throws(() => createTwFeeModel({ commissionRate: 2 }), /commissionRate/);
  assert.throws(() => createTwFeeModel({ commissionDiscount: -0.1 }), /commissionDiscount/);
  assert.throws(() => createTwFeeModel({ minCommission: -1 }), /minCommission/);
});

test("describeTwFeeModel：回傳純資料摘要（不碰 DOM），可供 UI 假設面板使用", () => {
  const described = describeTwFeeModel(STOCK_MODEL());
  assert.equal(described.kind, "tw-fee-model");
  assert.equal(described.name, "tw-fee-model");
  assert.equal(described.commissionRate, 0.001425);
  assert.equal(described.effectiveCommissionRate, 0.001425);
  assert.equal(described.minCommission, 20);
  assert.equal(described.sellTaxRateByInstrument.stock, 0.003);
  assert.equal(described.sellTaxRateByInstrument.etf, 0.001);
  assert.equal(described.dayTradeTaxRate, 0.0015);
  assert.deepEqual(described.dayTradeTaxAppliesTo, [TW_INSTRUMENT.STOCK]);
  assert.ok(Array.isArray(described.source) && described.source.length > 0);
  assert.ok(described.source.every((item) => typeof item.claim === "string" && typeof item.url === "string"));
  assert.match(described.accessed, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(described.effectiveFrom, /^\d{4}-\d{2}-\d{2}$/);
  // 純資料：可安全序列化，不含函式或 DOM 參考
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(described)));
});

test("DEFAULT_TW_FEE_ASSUMPTIONS：帶來源、查閱日期與生效日", () => {
  assert.equal(DEFAULT_TW_FEE_ASSUMPTIONS.commissionRate, 0.001425);
  assert.equal(DEFAULT_TW_FEE_ASSUMPTIONS.minCommission, 20);
  assert.equal(DEFAULT_TW_FEE_ASSUMPTIONS.sellTaxRateByInstrument.stock, 0.003);
  assert.equal(DEFAULT_TW_FEE_ASSUMPTIONS.sellTaxRateByInstrument.etf, 0.001);
  assert.equal(DEFAULT_TW_FEE_ASSUMPTIONS.dayTradeTaxRate, 0.0015);
  assert.match(DEFAULT_TW_FEE_ASSUMPTIONS.accessed, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(DEFAULT_TW_FEE_ASSUMPTIONS.effectiveFrom, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(DEFAULT_TW_FEE_ASSUMPTIONS.source.length >= 2);
});

test("scaleTwFeeModel：成本壓力倍數會放大費率，但不放大最低手續費", () => {
  const scaled = scaleTwFeeModel(STOCK_MODEL(), 2);
  assert.equal(scaled.assumptions.effectiveCommissionRate, 0.00285);
  assert.equal(scaled.assumptions.sellTaxRateByInstrument.stock, 0.006);
  assert.equal(scaled.assumptions.dayTradeTaxRate, 0.003);
  assert.equal(scaled.assumptions.minCommission, 20);
});

/* ── 回測／研究接上 FeeModel 的相容性驗證 ───────────────────────────────── */

const LEGACY_BARS = [
  { t: 1, o: 100, h: 104, l: 99, c: 102, v: 1000 },
  { t: 2, o: 103, h: 108, l: 102, c: 107, v: 1100 },
  { t: 3, o: 106, h: 107, l: 95, c: 96, v: 1200 },
  { t: 4, o: 95, h: 98, l: 93, c: 94, v: 900 },
];
const LEGACY_STRATEGY = ({ i }) => (i === 0 ? "buy" : i === 2 ? "sell" : "hold");

test("相容性：不給 feeModel 的 runBacktest 數字與既有 flat commissionRate 完全一致", () => {
  const result = runBacktest(LEGACY_BARS, LEGACY_STRATEGY, {
    initialCapital: 10_000,
    positionPct: 1,
    commissionRate: 0.001425,
    slippageBps: 0,
  });
  // 買進：103 × 96 股＝9,888，手續費 14.0904；賣出：95 × 96＝9,120，手續費 12.996
  assert.equal(result.trades.length, 1);
  assert.equal(result.trades[0].qty, 96);
  assert.ok(Math.abs(result.trades[0].fees - (14.0904 + 12.996)) < 1e-9);
  assert.ok(Math.abs(result.metrics.netProfit - (-795.0864)) < 1e-9, `netProfit=${result.metrics.netProfit}`);
  assert.equal(result.assumptions.commissionRate, 0.001425);
  assert.equal(result.assumptions.feeModel, null);
});

test("相容性：明確傳 feeModel: null 與完全不傳，結果逐欄相同", () => {
  const options = { initialCapital: 10_000, positionPct: 1, commissionRate: 0.001425, slippageBps: 0 };
  const without = runBacktest(LEGACY_BARS, LEGACY_STRATEGY, options);
  const withNull = runBacktest(LEGACY_BARS, LEGACY_STRATEGY, { ...options, feeModel: null });
  assert.deepEqual(withNull.metrics, without.metrics);
  assert.deepEqual(withNull.trades, without.trades);
  assert.deepEqual(withNull.equity, without.equity);
});

test("回測接上 TW FeeModel：賣方加徵 0.3% 證券交易稅，且最低手續費生效", () => {
  const result = runBacktest(LEGACY_BARS, LEGACY_STRATEGY, {
    initialCapital: 10_000,
    positionPct: 1,
    commissionRate: 0.001425,
    slippageBps: 0,
    feeModel: STOCK_MODEL(),
  });
  const trade = result.trades[0];
  assert.equal(trade.qty, 96);
  // 買進 9,888 → 手續費取 20 元最低；賣出 9,120 → 手續費 20 元＋證交稅 27.36
  assert.ok(Math.abs(trade.fees - (20 + 20 + 27.36)) < 1e-9, `fees=${trade.fees}`);
  assert.ok(Math.abs(result.metrics.netProfit - (-835.36)) < 1e-9, `netProfit=${result.metrics.netProfit}`);
  // 假設面板要能看到稅率與最低手續費
  assert.equal(result.assumptions.commissionRate, null);
  assert.equal(result.assumptions.feeModel.name, "tw-fee-model");
  assert.equal(result.assumptions.feeModel.minCommission, 20);
  assert.equal(result.assumptions.feeModel.sellTaxRateByInstrument.stock, 0.003);
});

function synthBars(n, drift, start = 1_700_000_000_000) {
  const bars = [];
  let price = 100;
  let t = start;
  for (let i = 0; i < n; i++) {
    price *= 1 + drift;
    bars.push({ t: (t += 86_400_000), o: price, h: price * 1.005, l: price * 0.995, c: price, v: 1000 });
  }
  return bars;
}

test("相容性：evaluateWindow 不給 feeModel 時與既有 flat 手續費一致", () => {
  const bars = synthBars(20, 0.001);
  const args = { symbol: "U", strategy: BUY_HOLD_STRATEGY, allocate: fullNotional(), commissionRate: 0.001425, slippageBps: 5 };
  const legacy = evaluateWindow({ ...args, evalBars: bars });
  const explicitNull = evaluateWindow({ ...args, evalBars: bars, feeModel: null });
  assert.deepEqual(explicitNull.trades, legacy.trades);
  assert.deepEqual(explicitNull.equity, legacy.equity);
  assert.equal(explicitNull.totalFees, legacy.totalFees);
  assert.equal(legacy.assumptions.feeModel, null);
  assert.equal(legacy.assumptions.commissionRate, 0.001425);
});

test("研究接上 TW FeeModel：總費用＝原本手續費＋賣方 0.3% 證券交易稅", () => {
  const bars = synthBars(20, 0.001);
  const args = { symbol: "U", strategy: BUY_HOLD_STRATEGY, allocate: fullNotional(), commissionRate: 0.001425, slippageBps: 5 };
  const legacy = evaluateWindow({ ...args, evalBars: bars });
  const withFees = evaluateWindow({ ...args, evalBars: bars, feeModel: STOCK_MODEL() });
  const exitNotional = legacy.trades[0].exitPrice * legacy.trades[0].qty;
  assert.ok(Math.abs(withFees.totalFees - (legacy.totalFees + exitNotional * 0.003)) < 1e-9);
  assert.equal(withFees.assumptions.commissionRate, null);
  assert.equal(withFees.assumptions.feeModel.sellTaxRateByInstrument.stock, 0.003);
  assert.equal(withFees.assumptions.feeModel.minCommission, 20);
});

test("summarizeResearch：可帶入 FeeModel 摘要，沒有時沿用 result.assumptions", () => {
  const bars = synthBars(20, 0.001);
  const args = { symbol: "U", strategy: BUY_HOLD_STRATEGY, allocate: fullNotional(), commissionRate: 0.001425, slippageBps: 5 };
  const result = evaluateWindow({ ...args, evalBars: bars, feeModel: STOCK_MODEL() });
  const summary = summarizeResearch(result, {});
  assert.equal(summary.feeModel.name, "tw-fee-model");
  assert.equal(summary.feeModel.sellTaxRateByInstrument.stock, 0.003);
  const explicit = summarizeResearch(result, { feeModel: STOCK_MODEL() });
  assert.equal(explicit.feeModel.name, "tw-fee-model");
  const legacySummary = summarizeResearch(evaluateWindow({ ...args, evalBars: bars }), {});
  assert.equal(legacySummary.feeModel, null);
});
