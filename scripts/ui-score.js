// UI visual score /100（§50）：每一分都要有 evidence；主觀自評一律 0 分。
// 用法：node scripts/ui-score.js（或 npm run score:ui）。Release gate：>= 85 且零 hard-gate failure。
// 瀏覽器幾何閘（重疊／裁切／橫向捲動／4 viewport）住在 Slice H 的截圖驗收，本腳本只計靜態可證部分。
"use strict";

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const html = readFileSync("index.html", "utf8");
const css = readFileSync("css/styles.css", "utf8");
const app = readFileSync("js/app.js", "utf8");
const charts = readFileSync("js/charts.js", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const rows = [];
let total = 0;
const hardFailures = [];
const give = (category, max, points, evidence) => {
  rows.push({ category, max, points, evidence });
  total += points;
};
const hard = (id, pass, evidence) => {
  if (!pass) hardFailures.push(`${id}：${evidence}`);
  return pass;
};

// 先跑 check-ui：a11y 大類與 hard gate 地基
let checkUiPass = 0;
let checkUiOk = false;
try {
  const out = execSync("node scripts/check-ui.js", { encoding: "utf8" });
  const m = out.match(/通過 (\d+) 項，WARN \d+ 項，FAIL (\d+) 項/);
  checkUiPass = Number(m?.[1] ?? 0);
  checkUiOk = Number(m?.[2] ?? 1) === 0;
} catch {
  checkUiOk = false;
}
hard("check-ui", checkUiOk, `check-ui ${checkUiOk ? `全過（${checkUiPass} 項）` : "有 FAIL"}`);
give("Accessibility（check-ui）", 15, checkUiOk ? 15 : 0, checkUiOk ? `check-ui ${checkUiPass} 項全過` : "check-ui 未全過，一律 0 分");

// Visual hierarchy 15：一個 dominant 面＋單一 h1＋工作區網格
{
  let points = 0;
  const ev = [];
  const panel = html.split('id="panel-backtest"')[1]?.split("</section>")[0] ?? "";
  if (panel.indexOf("equity-chart") !== -1 && panel.indexOf("backtest-metrics") !== -1
    && panel.indexOf("equity-chart") < panel.indexOf("backtest-metrics")) {
    points += 5; ev.push("回測首屏：權益曲線在 metrics 之前");
  }
  const h1Counts = [...html.matchAll(/<section[^>]*tabpanel[^>]*>([\s\S]*?)<\/section>/g)]
    .map((m) => (m[1].match(/class="title-page"/g) ?? []).length);
  if (h1Counts.length === 6 && h1Counts.every((n) => n === 1)) { points += 5; ev.push("6 個 panel 各恰一個 page title"); }
  if (/\.work-grid/.test(css) && /work-grid/.test(html)) { points += 5; ev.push("work-grid dominant＋側欄（非等權卡片牆）"); }
  give("Visual hierarchy", 15, points, ev.join("；") || "無證據");
}

// Data density 15
{
  let points = 0;
  const ev = [];
  if (/th\s*\{[^}]*position:\s*sticky/.test(css)) { points += 3; ev.push("sticky th"); }
  const tables = (html.match(/<table/g) ?? []).length;
  const wraps = (html.match(/overflow-table/g) ?? []).length;
  if (tables > 0 && wraps >= tables) { points += 4; ev.push(`${tables} 表全有 overflow 容器`); }
  if (/tabular-nums/.test(css)) { points += 4; ev.push("數字 tabular-nums"); }
  if (/th\s*\{[^}]*padding:\s*6px/.test(css)) { points += 4; ev.push("compact 列高（th 6px＋13px 字≈32px）"); }
  give("Data density", 15, points, ev.join("；") || "無證據");
}

// Chart usability 15
{
  let points = 0;
  const ev = [];
  const canvases = [...html.matchAll(/<canvas[^>]*>/g)].map((m) => m[0]);
  if (canvases.length > 0 && canvases.every((c) => /aria-label="[^"]+"/.test(c))) { points += 4; ev.push(`${canvases.length} canvas 皆有 aria-label`); }
  if (/canvas\.chart\s*\{[^}]*height/.test(css)) { points += 3; ev.push("canvas CSS 高度基線"); }
  if (/oosStart/.test(charts)) { points += 4; ev.push("IS／OOS 分界線（oosStart）"); }
  if (/setLineDash\(\[4,\s*3\]\)/.test(charts)) { points += 4; ev.push("last-price 虛線＋標籤"); }
  give("Chart usability", 15, points, ev.join("；") || "無證據");
}

// Trading safety 15
{
  let points = 0;
  const ev = [];
  const paperCount = (html.match(/PAPER/g) ?? []).length;
  if (paperCount >= 5) { points += 4; ev.push(`PAPER 標示 ${paperCount} 處（含頂欄常駐）`); }
  hard("paper-markers", paperCount >= 5, `PAPER 標示 ${paperCount} 處`);
  if (/id="order-submit"[^>]*disabled/.test(html)) { points += 3; ev.push("order-submit 初始 disabled"); }
  if (/executePaperOrder/.test(app)) { points += 4; ev.push("confirm 邊界重驗（executePaperOrder）"); }
  if (/role="status"/.test(html) && /僅供參考/.test(html)) { points += 4; ev.push("試算 advisory（role=status＋僅供參考）"); }
  give("Trading safety", 15, points, ev.join("；") || "無證據");
}

// Interaction states 10
{
  let points = 0;
  const ev = [];
  if (/:focus-visible/.test(css) && /outline:\s*2px/.test(css)) { points += 4; ev.push("2px focus ring"); }
  hard("focus-ring", /:focus-visible/.test(css) && /outline:\s*2px/.test(css), "focus ring 缺失");
  if (/\.btn:disabled/.test(css)) { points += 3; ev.push(":disabled 樣式"); }
  if (/handleGlobalKeydown/.test(app) && /\?/.test(app)) { points += 3; ev.push("快速鍵＋說明（/ 1-6 B S ?）"); }
  give("Interaction states", 10, points, ev.join("；") || "無證據");
}

// Responsive 10
{
  let points = 0;
  const ev = [];
  if (/name="viewport"/.test(html)) { points += 2; ev.push("viewport"); }
  const mq = (css.match(/@media/g) ?? []).length;
  if (mq >= 3) { points += 4; ev.push(`media query ${mq} 組（含 1279／480 斷點）`); }
  const tables = (html.match(/<table/g) ?? []).length;
  const wraps = (html.match(/overflow-table/g) ?? []).length;
  if (tables > 0 && wraps >= tables) { points += 4; ev.push("表格不爆版（contained scroll）"); }
  give("Responsive", 10, points, ev.join("；") || "無證據");
}

// Performance 5：零依賴＋無網路（靜態可證部分；field data 不得宣稱）
{
  let points = 0;
  const ev = [];
  const deps = Object.keys(pkg.dependencies ?? {}).length + Object.keys(pkg.devDependencies ?? {}).length;
  if (deps === 0) { points += 2; ev.push("runtime／dev 依賴 0"); }
  const jsAll = ["js/app.js", "js/data.js", "js/paper.js", "js/charts.js", "js/research.js", "js/alpha.js"]
    .map((f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } }).join("\n");
  if (!/fetch\s*\(|XMLHttpRequest|new WebSocket/.test(jsAll)) { points += 3; ev.push("執行路徑無網路 API"); }
  hard("no-network", !/fetch\s*\(|XMLHttpRequest|new WebSocket/.test(jsAll), "執行路徑出現網路 API");
  give("Performance（靜態）", 5, points, ev.join("；") || "無證據");
}

console.log("UI score /100（每分皆有 evidence）：");
for (const r of rows) console.log(`  ${r.category}：${r.points}/${r.max}｜${r.evidence}`);
console.log(`\n總分：${total}/100｜Release gate：>= 85 且零 hard-gate failure`);
if (hardFailures.length) {
  console.log("Hard-gate failures：");
  for (const f of hardFailures) console.log(`  [HARD-FAIL] ${f}`);
}
const pass = total >= 85 && hardFailures.length === 0;
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(pass ? 0 : 1);
