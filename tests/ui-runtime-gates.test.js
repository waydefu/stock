import test from "node:test";
import assert from "node:assert/strict";
import { checkRuntimeBoundaries } from "../scripts/ui-gates/runtime-boundaries.js";

function cleanFiles() {
  return {
    "server/market-proxy.js": "/api/market/stream",
    "server/fugle-stream-manager.js": "normalizeFugleTrade",
    "server/stream-sse.js": "text/event-stream",
    "js/app-stream-controller.js": '#stream-symbol STREAM_STARTED STREAM_SUBSCRIBE_FAILED STREAM_ERROR_ACTION RATE_LIMITED statePanel("error")',
    "js/sse-stream-client.js": "class SseStreamClient { generation = 1; }",
    "js/app-risk-audit-controller.js": "risk.status(); audit.list();",
    "js/paper-runtime.js": "new PaperBroker({ storage, feeModel });",
    "js/paper-fee-model.js": 'market === "TW"; market === "US"; dayTrade: false;',
    "js/app-auto-paper-controller.js": "adapter only",
    "js/auto-paper-runner.js": "recordResearchGate RESEARCH_APPROVED PAPER_ENABLED quoteIsFresh STALE_QUOTE canTrade executePaperOrder reconcileImmediateFill RECONCILIATION_FAILED risk.trip",
    "js/paper-reconciliation.js": "assertAccountingInvariants",
  };
}

function reader(files) {
  return (path) => files[path] ?? "";
}

test("runtime boundary gates pass on isolated clean contracts", () => {
  const files = cleanFiles();
  const results = checkRuntimeBoundaries({
    app: "createStreamController(); createAppPaperRuntime(); Paper 交易成本",
    html: '<div id="stream-alert"></div><button id="auto-paper-arm"></button><span id="auto-paper-state"></span>',
    readFile: reader(files),
  });
  assert.deepEqual(results.map((item) => item.id), [
    "stream-bridge-boundary",
    "stream-actionable-errors",
    "risk-audit-presentation-boundary",
    "paper-forward-fee-policy",
    "automated-paper-safety-boundary",
  ]);
  assert.ok(results.every((item) => item.problems.length === 0));
});

test("runtime boundary gates catch broker coupling in presentation controllers", () => {
  const files = cleanFiles();
  files["js/app-stream-controller.js"] += '\nimport { PaperBroker } from "./paper.js";';
  files["js/app-risk-audit-controller.js"] += "\nrisk.trip();";
  const results = checkRuntimeBoundaries({
    app: "",
    html: '<div id="stream-alert"></div>',
    readFile: reader(files),
  });
  assert.ok(results.find((item) => item.id === "stream-bridge-boundary").problems.length > 0);
  assert.ok(results.find((item) => item.id === "risk-audit-presentation-boundary").problems.length > 0);
});


test("runtime boundary gates reject a silent zero-fee app path", () => {
  const files = cleanFiles();
  const results = checkRuntimeBoundaries({
    app: "new PaperBroker({ storage });",
    html: '<div id="stream-alert"></div>',
    readFile: reader(files),
  });
  const feeGate = results.find((item) => item.id === "paper-forward-fee-policy");
  assert.ok(feeGate.problems.some((problem) => /createAppPaperRuntime|直接 new PaperBroker|Paper 交易成本/.test(problem)));
});
