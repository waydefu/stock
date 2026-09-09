import { existsSync, readFileSync } from "node:fs";

const required = [
  "index.html",
  "css/styles.css",
  "js/app.js",
  "js/data.js",
  "js/accounting.js",
  "js/execution-model.js",
  "js/order-errors.js",
  "js/dom.js",
  "js/market-rules.js",
  "js/session-clock.js",
  "js/charts.js",
  "js/backtest.js",
  "js/paper.js",
  "js/order-state.js",
  "js/order-service.js",
  "js/risk.js",
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
console.log(`Static smoke check passed: ${required.length} files and ${html.length} HTML bytes`);
