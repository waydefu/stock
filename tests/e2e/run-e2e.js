/* Browser E2E（Track C1，R-032）：用真瀏覽器跑真實使用者流程。
   為什麼要這一層：unit 測試與靜態閘門全綠時，核心流程仍可能壞掉
   （R-023 就是這樣漏網的：台股紙上下單在 UI 全數被拒）。
   工具只用在 CI（Playwright 不進 runtime，見決策 D6）；本機要跑先
   `npm install --no-save playwright@1.64.1 && npx playwright install chromium`。
   用法：node tests/e2e/run-e2e.js   */
import assert from "node:assert/strict";
import { startEnvironment } from "./harness.js";

const TAIPEI_SESSION = new Date("2026-09-15T02:00:00Z"); // 週二 10:00（台北）

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("E2E FAIL：找不到 playwright。CI 會先安裝；本機請執行 npm install --no-save playwright@1.64.1");
  process.exit(1);
}

const results = [];

async function scenario(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`ok  - ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error });
    console.error(`not ok - ${name} (${Date.now() - started}ms)`);
    console.error(`  ${error?.stack ?? error}`);
  }
}

const env = await startEnvironment();
const openContexts = [];
const browser = await chromium.launch();

async function newPage({ clock = true } = {}) {
  const context = await browser.newContext();
  openContexts.push(context);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(String(error?.message ?? error)));
  if (clock) await page.clock.setFixedTime(TAIPEI_SESSION);
  await page.goto(`${env.staticUrl}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("#kpi-equity")?.textContent?.trim() !== "—");
  return { context, page, consoleErrors };
}

try {
  await scenario("app 啟動無 console 錯誤，儀表板有數字", async () => {
    const { context, page, consoleErrors } = await newPage();
    const equity = await page.textContent("#kpi-equity");
    assert.ok(equity && equity.trim() !== "—", `KPI 應有數字：${equity}`);
    assert.deepEqual(consoleErrors, [], `console 錯誤：${consoleErrors.join(" / ")}`);
    await context.close();
  });

  await scenario("台股紙上單：預覽顯示參考價、確認後寫入帳本", async () => {
    const { context, page, consoleErrors } = await newPage();
    await page.selectOption("#role-select", "trader");
    await page.click("#tab-trade");
    await page.waitForSelector("#panel-trade:not([hidden])");
    await page.selectOption("#order-symbol", "2330");
    await page.fill("#order-qty", "10");
    await page.waitForFunction(() => Number(document.querySelector("#order-price")?.value) > 0);
    await page.click("#order-preview");
    await page.waitForSelector("#order-modal:not([hidden])");
    const modalText = await page.textContent("#order-modal-body");
    assert.ok(modalText.includes("參考價"), `確認對話框必須顯示參考價：${modalText}`);
    await page.click("#order-confirm");
    await page.waitForFunction(() => document.querySelector("#positions-table tbody")?.textContent?.includes("2330"));
    const positions = await page.textContent("#positions-table tbody");
    assert.ok(positions.includes("2330"), `持倉表應有 2330：${positions}`);
    assert.deepEqual(consoleErrors, [], `console 錯誤：${consoleErrors.join(" / ")}`);
    await context.close();
  });

  await scenario("斷路器手動啟動後 reload 仍維持凍結", async () => {
    const { context, page } = await newPage();
    await page.selectOption("#role-select", "risk");
    await page.click("#tab-risk");
    await page.waitForSelector("#panel-risk:not([hidden])");
    await page.click("#kill-switch");
    await page.waitForFunction(() => document.querySelector("#risk-state")?.textContent?.includes("已凍結"));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("#risk-state")?.textContent?.includes("已凍結"));
    const state = await page.textContent("#risk-state");
    assert.ok(state.includes("已凍結"), `reload 後仍應凍結：${state}`);
    await context.close();
  });

  await scenario("Fugle 模式報價來自 proxy（fixture 上游）", async () => {
    const { context, page, consoleErrors } = await newPage();
    await page.click("#tab-trade");
    await page.waitForSelector("#panel-trade:not([hidden])");
    await page.selectOption("#data-mode", "fugle-proxy");
    await page.fill("#fugle-symbol", "2330");
    await page.click("#fugle-quote-btn");
    await page.waitForFunction(() => document.querySelector("#fugle-quote")?.textContent?.includes("568"), null, { timeout: 10000 });
    const quote = await page.textContent("#fugle-quote");
    assert.ok(quote.includes("568"), `報價應來自 proxy fixture：${quote}`);
    assert.ok(/fugle/i.test(quote), `報價需標示來源：${quote}`);
    assert.ok(/STALE|FRESH/.test(quote), `報價需標示新鮮度：${quote}`);
    assert.deepEqual(consoleErrors, [], `console 錯誤：${consoleErrors.join(" / ")}`);
    await context.close();
  });

  await scenario("串流：上游斷線後重連並回到 LIVE", async () => {
    const { context, page } = await newPage();
    await page.click("#tab-trade");
    await page.waitForSelector("#panel-trade:not([hidden])");
    await page.selectOption("#data-mode", "fugle-proxy");
    await page.fill("#stream-symbol", "2330");
    await page.click("#stream-start");
    await page.waitForFunction(() => document.querySelector("#stream-state-badge")?.textContent?.trim() === "LIVE", null, { timeout: 10000 });
    // 模擬上游斷線：管理端應進入 RECONNECTING，之後自動回到 LIVE。
    env.upstream.dropAll();
    await page.waitForFunction(() => {
      const badge = document.querySelector("#stream-state-badge")?.textContent?.trim();
      return badge === "RECONNECTING" || badge === "LIVE";
    }, null, { timeout: 10000 });
    await page.waitForFunction(() => document.querySelector("#stream-state-badge")?.textContent?.trim() === "LIVE", null, { timeout: 20000 });
    const badge = await page.textContent("#stream-state-badge");
    assert.equal(badge.trim(), "LIVE");
    await context.close();
  });
  await scenario("選股：套用條件後有結果（不是只有空狀態）", async () => {
    const { context, page, consoleErrors } = await newPage();
    await page.click("#tab-screener");
    await page.waitForSelector("#panel-screener:not([hidden])");
    await page.click("#screen-run");
    await page.waitForFunction(() => document.querySelector("#screener-table tbody")?.textContent?.trim().length > 0);
    const rows = await page.$$("#screener-table tbody tr");
    assert.ok(rows.length > 0, "篩選後應有列");
    assert.deepEqual(consoleErrors, [], `console 錯誤：${consoleErrors.join(" / ")}`);
    await context.close();
  });

  await scenario("回測：執行後有指標與模型假設", async () => {
    const { context, page, consoleErrors } = await newPage();
    await page.click("#tab-backtest");
    await page.waitForSelector("#panel-backtest:not([hidden])");
    await page.click("#backtest-run");
    await page.waitForFunction(() => document.querySelector("#backtest-metrics")?.textContent?.trim().length > 0, null, { timeout: 30000 });
    const assumptions = await page.textContent("#backtest-assumptions");
    assert.ok(assumptions.includes("手續費"), `假設面板應列出手續費：${assumptions}`);
    assert.deepEqual(consoleErrors, [], `console 錯誤：${consoleErrors.join(" / ")}`);
    await context.close();
  });

  await scenario("策略中心：執行比較後有 gate 結論", async () => {
    const { context, page, consoleErrors } = await newPage();
    await page.click("#tab-backtest");
    await page.waitForSelector("#panel-backtest:not([hidden])");
    await page.click("#strategy-run");
    await page.waitForFunction(() => document.querySelector("#strategy-gate")?.textContent?.trim().length > 0, null, { timeout: 120000 });
    const gate = await page.textContent("#strategy-gate");
    assert.ok(gate.length > 0, "策略中心應給出 gate 結論");
    assert.deepEqual(consoleErrors, [], `console 錯誤：${consoleErrors.join(" / ")}`);
    await context.close();
  });

  await scenario("鍵盤快速鍵：數字鍵切換頁籤", async () => {
    const { context, page } = await newPage();
    await page.keyboard.press("2");
    await page.waitForFunction(() => !document.querySelector("#panel-chart")?.hasAttribute("hidden"));
    const selected = await page.getAttribute("#tab-chart", "aria-selected");
    assert.equal(selected, "true");
    await context.close();
  });

} finally {
  for (const context of openContexts) {
    try { await context.close(); } catch { /* already closed */ }
  }
  await browser.close();
  await env.close();
}

const failed = results.filter((result) => !result.ok);
console.log(`\nE2E：${results.length - failed.length}/${results.length} 通過`);
if (failed.length > 0) {
  console.error(`E2E FAIL：${failed.map((result) => result.name).join("、")}`);
  process.exit(1);
}
process.exit(0);
