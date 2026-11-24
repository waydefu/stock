/* 台股成本模型（研究／回測與可注入的 paper runtime policy 共用；PaperBroker constructor 預設仍 zero-fee 以保留 DI／測試控制）。
   這個模組是「來源常數模組」：可以放官方網址作為出處，但不得含網路 API
   （check-ui 第 12 項會檢查）。模型本身是純函式，不碰 DOM、不連網。 */
"use strict";

import { feeFor } from "./accounting.js";

/* ── 台股成本模型（研究／回測；App paper runtime 由 paper-fee-model.js 注入）────────
   費用拆成兩塊：
     1. 手續費：單邊收取，費率 = 費率上限／基準 × (1 − 折讓)，且每筆不得低於最低手續費。
     2. 證券交易稅：只有賣方繳，稅基是「成交金額」（price × qty，不含手續費）。

   官方依據（詳見 docs/RESEARCH_LEDGER.md 本輪條目）：
   - 《證券交易稅條例》第 2 條：股票千分之三；公司債及其他經政府核准之有價證券千分之一
     （ETF／受益憑證落在後者）。第 2-2 條：上市或上櫃「股票」當日沖銷千分之一點五。
   - 臺灣證券交易所營業細則第 94 條：手續費率逾千分之一點四二五者應於委託前通知委託人；
     折讓與每筆委託最低費用由經紀商自行訂定並申報證交所備查。 */

export const TW_INSTRUMENT = Object.freeze({
  STOCK: "stock",
  ETF: "etf",
  WARRANT: "warrant",
});

export const DEFAULT_TW_FEE_ASSUMPTIONS = Object.freeze({
  // 手續費率（單邊）。0.1425% ＝ 千分之一點四二五，營業細則第 94 條的「事前通知門檻」，
  // 也是市場上最常見的收取標準；此處不假設任何折讓（保守估計）。
  commissionRate: 0.001425,
  // 折讓比例（0 = 不折讓；0.28 代表減收 28%）。市場實務另有「幾折」用法（付 28% ＝ 減收 72%），
  // 兩者不可混用，UI 顯示時必須標明是「減收 %」還是「幾折」。
  commissionDiscount: 0,
  // 單筆最低手續費（元）。法源是營業細則第 94 條「得訂定每筆委託最低費用」，
  // 金額由各券商收費標準自訂；20 元為市場慣例值，非法律明定。
  minCommission: 20,
  // 賣方證券交易稅率（依商品別）。股票 0.3%、ETF／受益憑證 0.1%。
  sellTaxRateByInstrument: Object.freeze({
    [TW_INSTRUMENT.STOCK]: 0.003,
    [TW_INSTRUMENT.ETF]: 0.001,
    [TW_INSTRUMENT.WARRANT]: 0.001,
  }),
  // 當日沖銷（同一帳戶同一營業日現款買進＋現券賣出同種類同數量）股票賣方稅率 0.15%。
  dayTradeTaxRate: 0.0015,
  // 證券交易稅條例第 2-2 條只適用「上市或上櫃股票」，ETF／受益憑證當沖仍用上列一般稅率。
  dayTradeTaxAppliesTo: Object.freeze([TW_INSTRUMENT.STOCK]),
  source: Object.freeze([
    Object.freeze({
      claim: "證券交易稅：股票千分之三、公司債及其他經政府核准之有價證券千分之一；上市或上櫃股票當日沖銷千分之一點五",
      url: "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=G0340078",
      authority: "《證券交易稅條例》第 2 條、第 2-2 條（財政部／全國法規資料庫）",
    }),
    Object.freeze({
      claim: "手續費：費率由證交所申報主管機關核定；逾千分之一點四二五須於委託前通知委託人；折讓與每筆委託最低費用由經紀商自訂並申報證交所備查",
      url: "https://twse-regulation.twse.com.tw/TW/law/DOC01.aspx?FLCODE=FL007304&FLNO=94",
      authority: "臺灣證券交易所營業細則第 94 條",
    }),
  ]),
  accessed: "2026-10-22",
  // 《證券交易稅條例》最近一次修正日；當日沖銷稅率的免稅期另見法條第 2-2 條。
  effectiveFrom: "2025-01-02",
});

function requireRate(value, label) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error(`${label} 必須是 0 到 1 之間的有限數值`);
  return rate;
}

/**
 * 建立台股成本模型。
 *
 * @param {object} options
 * @param {number} options.commissionRate 手續費率（費率上限／基準，單邊）。
 * @param {number} options.commissionDiscount 折讓比例（減收幾成，0 = 不折讓）。
 * @param {number} options.minCommission 單筆最低手續費（金額單位同市場幣別）。
 * @param {Record<string, number>} options.sellTaxRateByInstrument 商品別賣方證券交易稅率。
 * @param {number} options.dayTradeTaxRate 當日沖銷賣方證券交易稅率。
 * @param {string[]} options.dayTradeTaxAppliesTo 當沖稅率適用的商品別。
 * @param {string} options.instrumentType 模型預設商品別。
 * @returns {{name:string, kind:string, calculate:(ctx:object)=>number, breakdown:(ctx:object)=>object, assumptions:object}}
 *
 * calculate(context) 的 context 契約：
 *   side          "buy" | "sell"（必填，賣方才計證券交易稅）
 *   price         成交單價（必填，非負有限數）
 *   qty           成交股數（必填，非負有限數；0 → 費用 0）
 *   instrumentType 商品別（缺漏時用模型預設值；未知商品別直接報錯）
 *   dayTrade      是否為當日沖銷（預設 false）
 */
export function createTwFeeModel({
  commissionRate = DEFAULT_TW_FEE_ASSUMPTIONS.commissionRate,
  commissionDiscount = DEFAULT_TW_FEE_ASSUMPTIONS.commissionDiscount,
  minCommission = DEFAULT_TW_FEE_ASSUMPTIONS.minCommission,
  sellTaxRateByInstrument = DEFAULT_TW_FEE_ASSUMPTIONS.sellTaxRateByInstrument,
  dayTradeTaxRate = DEFAULT_TW_FEE_ASSUMPTIONS.dayTradeTaxRate,
  dayTradeTaxAppliesTo = DEFAULT_TW_FEE_ASSUMPTIONS.dayTradeTaxAppliesTo,
  instrumentType = TW_INSTRUMENT.STOCK,
  name = "tw-fee-model",
  source = DEFAULT_TW_FEE_ASSUMPTIONS.source,
  accessed = DEFAULT_TW_FEE_ASSUMPTIONS.accessed,
  effectiveFrom = DEFAULT_TW_FEE_ASSUMPTIONS.effectiveFrom,
} = {}) {
  const baseRate = requireRate(commissionRate, "commissionRate");
  const discount = requireRate(commissionDiscount, "commissionDiscount");
  const minFee = Number(minCommission);
  if (!Number.isFinite(minFee) || minFee < 0) throw new Error("minCommission 必須是非負有限數值");
  const taxes = {};
  for (const [key, value] of Object.entries(sellTaxRateByInstrument ?? {})) {
    taxes[key] = requireRate(value, `sellTaxRateByInstrument.${key}`);
  }
  const dayRate = requireRate(dayTradeTaxRate, "dayTradeTaxRate");
  const dayTradeTypes = Object.freeze([...(dayTradeTaxAppliesTo ?? [])]);
  const defaultInstrument = String(instrumentType);
  if (!Object.hasOwn(taxes, defaultInstrument)) throw new Error(`不支援的商品別：${defaultInstrument}`);
  const effectiveRate = baseRate * (1 - discount);

  const taxRateFor = (type, dayTrade) => {
    if (dayTrade && dayTradeTypes.includes(type)) return dayRate;
    return taxes[type];
  };

  /** 拆出手續費／證券交易稅明細，供 UI 顯示與測試使用。 */
  const breakdown = (context = {}) => {
    const side = String(context.side ?? "").toLowerCase();
    if (side !== "buy" && side !== "sell") throw new Error("FeeModel context.side 必須是 buy 或 sell");
    const price = Number(context.price);
    const qty = Number(context.qty);
    if (!Number.isFinite(price) || price < 0) throw new Error("FeeModel context.price 必須是非負有限數值");
    if (!Number.isFinite(qty) || qty < 0) throw new Error("FeeModel context.qty 必須是非負有限數值");
    const type = String(context.instrumentType ?? defaultInstrument);
    if (!Object.hasOwn(taxes, type)) throw new Error(`不支援的商品別：${type}`);
    const dayTrade = Boolean(context.dayTrade);
    const notional = price * qty;
    if (notional === 0) return { side, instrumentType: type, dayTrade, notional: 0, commission: 0, tax: 0, total: 0, commissionRate: effectiveRate, taxRate: 0 };
    const commission = Math.max(notional * effectiveRate, minFee);
    const taxRate = side === "sell" ? taxRateFor(type, dayTrade) : 0;
    const tax = notional * taxRate;
    return { side, instrumentType: type, dayTrade, notional, commission, tax, total: commission + tax, commissionRate: effectiveRate, taxRate };
  };

  const assumptions = Object.freeze({
    commissionRate: baseRate,
    commissionDiscount: discount,
    effectiveCommissionRate: effectiveRate,
    minCommission: minFee,
    sellTaxRateByInstrument: Object.freeze({ ...taxes }),
    dayTradeTaxRate: dayRate,
    dayTradeTaxAppliesTo: dayTradeTypes,
    instrumentType: defaultInstrument,
    source: Object.freeze([...(source ?? [])].map((item) => (typeof item === "string" ? Object.freeze({ claim: item, url: null, authority: null }) : Object.freeze({ ...item })))),
    accessed,
    effectiveFrom,
  });

  return Object.freeze({
    name: String(name),
    kind: "tw-fee-model",
    calculate: (context) => breakdown(context).total,
    breakdown,
    assumptions,
  });
}

/**
 * 把 FeeModel 轉成可顯示的純資料摘要（不碰 DOM）。
 * 非本 repo 建立的模型（例如 paper broker 的 zero-fee 模型）也能安全降級。
 */
export function describeTwFeeModel(model) {
  if (!model || typeof model.calculate !== "function") throw new Error("FeeModel 必須提供 calculate(context)");
  const a = model.assumptions ?? {};
  return {
    kind: model.kind ?? "custom",
    name: model.name ?? "unnamed-fee-model",
    commissionRate: a.commissionRate ?? null,
    commissionDiscount: a.commissionDiscount ?? null,
    effectiveCommissionRate: a.effectiveCommissionRate ?? null,
    minCommission: a.minCommission ?? null,
    sellTaxRateByInstrument: a.sellTaxRateByInstrument ? { ...a.sellTaxRateByInstrument } : null,
    dayTradeTaxRate: a.dayTradeTaxRate ?? null,
    dayTradeTaxAppliesTo: Array.isArray(a.dayTradeTaxAppliesTo) ? [...a.dayTradeTaxAppliesTo] : null,
    instrumentType: a.instrumentType ?? null,
    source: Array.isArray(a.source) ? a.source.map((item) => ({ ...item })) : [],
    accessed: a.accessed ?? null,
    effectiveFrom: a.effectiveFrom ?? null,
  };
}

/**
 * 以 FeeModel 估算「買得起」的股數。
 * 先用整筆預算探測有效手續費率（含最低手續費），再用模型實際費用核對現金是否足夠，
 * 避免低估費用導致現金變成負數；回測／研究是日 K 層級，所以 dayTrade 一律 false。
 */
export function feeModelAffordableQty(feeModel, budget, price, instrumentType) {
  if (!(budget > 0) || !(price > 0)) return 0;
  const probeQty = Math.floor(budget / price);
  if (probeQty <= 0) return 0;
  const probeFee = feeFor(feeModel, { side: "buy", price, qty: probeQty, instrumentType, dayTrade: false });
  const probeNotional = price * probeQty;
  const effectiveRate = probeNotional > 0 ? probeFee / probeNotional : 0;
  let candidate = Math.floor(budget / (price * (1 + effectiveRate)));
  if (candidate <= 0) return 0;
  for (let guard = 0; guard < 1000 && candidate > 0; guard++) {
    const cost = price * candidate;
    const fees = feeFor(feeModel, { side: "buy", price, qty: candidate, instrumentType, dayTrade: false });
    if (cost + fees <= budget + 1e-9) return candidate;
    candidate -= 1;
  }
  return 0;
}

/** 以倍數縮放台股成本模型（成本壓力測試用；最低手續費不隨倍數放大）。
 *  非本 repo 建立的模型（沒有 assumptions）原樣返回，代表無法縮放。 */
export function scaleTwFeeModel(model, multiplier) {
  const mult = Number(multiplier);
  if (!Number.isFinite(mult) || mult <= 0) throw new Error("multiplier 必須是正數");
  const a = model?.assumptions;
  if (!a || typeof a.commissionRate !== "number") return model;
  const taxes = {};
  for (const [key, value] of Object.entries(a.sellTaxRateByInstrument ?? {})) taxes[key] = value * mult;
  return createTwFeeModel({
    commissionRate: a.commissionRate * mult,
    commissionDiscount: a.commissionDiscount,
    minCommission: a.minCommission,
    sellTaxRateByInstrument: taxes,
    dayTradeTaxRate: a.dayTradeTaxRate * mult,
    dayTradeTaxAppliesTo: a.dayTradeTaxAppliesTo,
    instrumentType: a.instrumentType,
    name: `${model.name ?? "tw-fee-model"}-x${mult}`,
    source: a.source,
    accessed: a.accessed,
    effectiveFrom: a.effectiveFrom,
  });
}
