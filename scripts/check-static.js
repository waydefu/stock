import { existsSync, readFileSync } from "node:fs";

const required = [
  "index.html",
  "css/styles.css",
  "js/app.js",
  "js/app-stream-controller.js",
  "js/app-risk-audit-controller.js",
  "js/app-auto-paper-controller.js",
  "js/data.js",
  "js/accounting.js",
  "js/execution-model.js",
  "js/order-errors.js",
  "js/dom.js",
  "js/favorites.js",
  "js/view.js",
  "js/market-data.js",
  "js/market-rules.js",
  "js/session-clock.js",
  "js/trading-calendar.js",
  "js/tw-market-holidays.js",
  "js/corporate-actions.js",
  "js/charts.js",
  "js/classic-strategies.js",
  "js/backtest.js",
  "js/strategy.js",
  "js/alpha.js",
  "js/portfolio.js",
  "js/research.js",
  "js/paper.js",
  "js/paper-fee-model.js",
  "js/paper-runtime.js",
  "js/paper-reconciliation.js",
  "js/auto-paper-runner.js",
  "js/auto-paper-promotion.js",
  "js/order-state.js",
  "js/order-service.js",
  "js/risk.js",
  "server/start-market-proxy.js",
  "server/market-proxy.js",
  "server/auto-paper-service.js",
  "server/file-kv-storage.js",
  "server/forward-test-journal.js",
  "server/forward-test-metrics.js",
  "scripts/report-auto-paper.js",
  "README.md",
  "DISCLAIMER.md",
];
const missing = required.filter((path) => !existsSync(path));
if (missing.length) {
  console.error(`Missing required static files: ${missing.join(", ")}`);
  process.exit(1);
}
const html = readFileSync("index.html", "utf8");
for (const marker of ["<title>", "css/styles.css", 'type="module"', "js/app.js", "data-page=\"dashboard\"", "data-page=\"trade\""]) {
  if (!html.includes(marker)) {
    console.error(`index.html missing required marker: ${marker}`);
    process.exit(1);
  }
}
if (html.includes("api_key=") || html.includes("secret_key=")) {
  console.error("index.html contains a credential-shaped assignment");
  process.exit(1);
}
const serverAuto = readFileSync("server/auto-paper-service.js", "utf8");
const serverStart = readFileSync("server/start-market-proxy.js", "utf8");
const proxy = readFileSync("server/market-proxy.js", "utf8");
for (const requiredMarker of [
  "AUTO_PAPER_DURABLE_STORAGE_CONFIRMED",
  "AUTO_PAPER_ALWAYS_ON_CONFIRMED",
  "AUTO_PAPER_STATE_FILE",
  "strictPersistence: true",
  "FileKeyValueStorage",
  "ForwardTestJournal",
  "journal.recordCycle",
  "serverAutoScheduleDecision",
  "getCurrentSession",
]) {
  if (!serverAuto.includes(requiredMarker)) {
    console.error(`server Auto authority missing fail-closed marker: ${requiredMarker}`);
    process.exit(1);
  }
}
if (!serverStart.includes("resolveServerAutoPaperConfig") || !serverStart.includes("autoPaper?.stop")) {
  console.error("server entrypoint does not own Auto Paper startup/shutdown lifecycle");
  process.exit(1);
}
if (/\/api\/(?:paper|trade|order|broker)/i.test(proxy)) {
  console.error("public market proxy exposes a trading mutation-shaped route");
  process.exit(1);
}
const forwardJournal = readFileSync("server/forward-test-journal.js", "utf8");
const forwardMetrics = readFileSync("server/forward-test-metrics.js", "utf8");
const forwardReport = readFileSync("scripts/report-auto-paper.js", "utf8");
if (!/DURABLE_JOURNAL_INVALID/.test(forwardJournal) || !/DURABLE_JOURNAL_FULL/.test(forwardJournal)) {
  console.error("forward-test journal must fail closed on corruption/capacity");
  process.exit(1);
}
if (!/summarizeDailyRisk/.test(forwardMetrics) || !/summarizeClosedTrades/.test(forwardMetrics) || !/summarizeBuyHold/.test(forwardMetrics)) {
  console.error("forward-test metrics missing daily risk / closed trades / benchmark");
  process.exit(1);
}
if (!/buildForwardTestReport/.test(forwardReport) || /setItem\s*\(/.test(forwardReport)) {
  console.error("Auto Paper report must remain read-only");
  process.exit(1);
}
if (/live.?broker|real.?broker/i.test(serverAuto)) {
  console.error("server Auto Paper module contains live-broker-shaped coupling");
  process.exit(1);
}

console.log(`Static smoke check passed: ${required.length} files and ${html.length} HTML bytes`);
