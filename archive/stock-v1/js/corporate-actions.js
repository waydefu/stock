"use strict";

export const CORPORATE_ACTION_TYPE = Object.freeze({
  SPLIT: "SPLIT",
  DIVIDEND: "DIVIDEND",
  CAPITAL_REDUCTION: "CAPITAL_REDUCTION",
  SYMBOL_CHANGE: "SYMBOL_CHANGE",
  DELISTING: "DELISTING",
});

const SYMBOL_PATTERN = /^[A-Za-z0-9.]+$/;

export function validateCorporateAction(input) {
  if (!input || typeof input !== "object" || !Object.values(CORPORATE_ACTION_TYPE).includes(input.type)) {
    return { ok: false, code: "INVALID_CORPORATE_ACTION", reason: "corporate action type is unsupported" };
  }
  if (typeof input.symbol !== "string" || !SYMBOL_PATTERN.test(input.symbol) || typeof input.effectiveDate !== "string" || Number.isNaN(Date.parse(input.effectiveDate)) || typeof input.source !== "string" || !input.source) {
    return { ok: false, code: "INVALID_CORPORATE_ACTION", reason: "corporate action provenance or identity is incomplete" };
  }
  return { ok: true, code: "VALID", action: { ...input } };
}
