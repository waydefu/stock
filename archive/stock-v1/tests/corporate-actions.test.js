import assert from "node:assert/strict";
import test from "node:test";
import { CORPORATE_ACTION_TYPE, validateCorporateAction } from "../js/corporate-actions.js";

test("corporate action contract accepts sourced action types without inventing adjustments", () => {
  assert.deepEqual(Object.values(CORPORATE_ACTION_TYPE), ["SPLIT", "DIVIDEND", "CAPITAL_REDUCTION", "SYMBOL_CHANGE", "DELISTING"]);
  const action = validateCorporateAction({ type: "SPLIT", symbol: "2330", effectiveDate: "2025-01-01", source: "official-provider" });
  assert.equal(action.ok, true);
  assert.equal(action.action.type, "SPLIT");
});

test("corporate action contract rejects incomplete untrusted input", () => {
  assert.equal(validateCorporateAction({ type: "SPLIT", symbol: "2330" }).ok, false);
  assert.equal(validateCorporateAction({ type: "UNKNOWN", symbol: "2330", effectiveDate: "2025-01-01" }).code, "INVALID_CORPORATE_ACTION");
});
