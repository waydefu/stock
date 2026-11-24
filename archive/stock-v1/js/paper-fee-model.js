/* Paper runtime fee policy.
   TW uses the sourced TW FeeModel; US remains explicit zero-fee until a sourced US paper-cost policy exists.
   This is runtime policy, not PaperBroker's constructor default, so deterministic broker tests keep DI control. */
"use strict";

import { ZERO_FEE_MODEL } from "./accounting.js";
import { TW_INSTRUMENT, createTwFeeModel } from "./tw-fee-model.js";

export const PAPER_FEE_POLICY_VERSION = 1;

export function createPaperFeeModel({
  twFeeModel = createTwFeeModel({ instrumentType: TW_INSTRUMENT.STOCK, name: "paper-tw-general-stock-cost-v1" }),
  usFeeModel = ZERO_FEE_MODEL,
} = {}) {
  if (!twFeeModel || typeof twFeeModel.calculate !== "function") throw new Error("twFeeModel 必須提供 calculate(context)");
  if (!usFeeModel || typeof usFeeModel.calculate !== "function") throw new Error("usFeeModel 必須提供 calculate(context)");

  return Object.freeze({
    name: "paper-market-fee-policy-v1",
    kind: "market-dispatch-fee-model",
    policyVersion: PAPER_FEE_POLICY_VERSION,
    calculate(context = {}) {
      const market = String(context.market ?? "").toUpperCase();
      if (market === "TW") {
        return twFeeModel.calculate({
          ...context,
          instrumentType: context.instrumentType ?? TW_INSTRUMENT.STOCK,
          // Paper positions do not yet retain acquisition-session provenance.
          // Use the ordinary sell-tax rate instead of guessing day-trade eligibility.
          dayTrade: false,
        });
      }
      if (market === "US") return usFeeModel.calculate(context);
      throw new Error(`不支援的 paper fee market：${market || "(empty)"}`);
    },
    policies: Object.freeze({
      TW: twFeeModel.name ?? "tw-fee-model",
      US: usFeeModel.name ?? "zero-fee-paper",
    }),
  });
}
