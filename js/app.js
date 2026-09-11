/* Stock Lab UI orchestration.
   介面層只組合資料、回測、風控與紙上 broker；沒有網路、秘密或真實下單副作用。 */
"use strict";

import { SYMBOLS, fmtDate, fmtInt, fmtPrice, getSymbol, rsi, volumeRatio } from "./data.js";
import { selectAdapter } from "./fixture-provider.js";
import { drawCandles, drawLine, candleHoverAt } from "./charts.js";
import { formatMetric, runBacktest, STRATEGIES } from "./backtest.js";
import { evaluateWindow } from "./research.js";
import { MemoryStorage, PaperBroker } from "./paper.js";
import { executePaperOrder } from "./order-service.js";
import { escapeHtml } from "./dom.js";
import { loadFavorites, toggleFavorite } from "./favorites.js";
import { avgLast, fmtDay, money, orderEstimate, pct, signed, statePanel, stateRow, symbolLabel, tone } from "./view.js";
import { AuditLog, DEFAULT_RISK, ROLE_PERMISSIONS, RiskEngine, permissionsFor } from "./risk.js";
import { FugleProxyAdapter } from "./fugle-proxy-adapter.js";
import { fugleResearchRange } from "./research-range.js";
import { MARKET_DATA_PROXY_URL } from "./proxy-config.js";
import { getCurrentSession } from "./market-rules.js";
import { buildDefaultRegistry, makeTrendStrategy } from "./alpha.js";
import { fixedFraction, fullNotional } from "./portfolio.js";
import {
  evaluatePromotion,
  evaluateTrendSurface,
  parameterSurface,
  runCostStress,
  runResearchBacktest,
  splitIS_OOS,
  summarizeResearch,
  walkForward,
} from "./research.js";

const state = {
  market: "TW",
  role: "observer",
  symbol: "2330",
  page: "dashboard",
  chartWindow: 90,
  pendingOrder: null,
  modalTrigger: null,
  dataMode: "simulation",
};
let clientOrderSequence = 0;

const storage = typeof localStorage === "undefined" ? new MemoryStorage() : localStorage;
const broker = new PaperBroker({ storage });
const marketData = selectAdapter("simulation");
const risk = new RiskEngine(DEFAULT_RISK);
const audit = new AuditLog({ storage });
const registry = buildDefaultRegistry();
const PAGE_ORDER = ["dashboard", "chart", "screener", "backtest", "trade", "risk"];
const isResearchStrategy = (id) => typeof id === "string" && id.startsWith("research:");
const researchDef = (id) => registry.get(id.slice("research:".length));
const na = (value, format) => value === null || value === undefined || !Number.isFinite(value) ? "N/A" : format(value);
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const nextClientOrderId = () => globalThis.crypto?.randomUUID?.() ?? `ui-${Date.now()}-${++clientOrderSequence}`;

function marketSymbols() { return SYMBOLS.filter((item) => item.market === state.market); }
function currentQuote(code = state.symbol) { return marketData.quote(code); }
function quoteMap(market = state.market) {
  return Object.fromEntries(marketSymbolsFor(market).map((item) => [item.code, marketData.quote(item.code)]));
}
function marketSymbolsFor(market) { return SYMBOLS.filter((item) => item.market === market); }

function auditEvent(event, details) {
  audit.record(event, { ...details, mode: "paper", role: state.role, market: state.market });
  renderAudit();
}

function setMarket(market) {
  state.market = market;
  state.symbol = marketSymbols()[0].code;
  $$("[data-market]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.market === market)));
  auditEvent("MARKET_CHANGED", { target: market });
  populateSymbolSelects();
  renderAll();
}

function setPage(page) {
  state.page = page;
  $$(".tabs [role=tab]").forEach((button) => {
    const selected = button.dataset.page === page;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  $$(".page[role=tabpanel]").forEach((panel) => {
    const active = panel.dataset.pagePanel === page;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
    panel.setAttribute("aria-hidden", String(!active));
  });
  if (page === "chart") renderChart();
  if (page === "backtest") renderBacktest();
  if (page === "trade") renderTrade();
  if (page === "risk") renderRisk();
}

function handleTabKeydown(event) {
  const tabs = $$(".tabs [role=tab]");
  const index = tabs.indexOf(event.currentTarget);
  if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  const next = tabs[nextIndex];
  next.focus();
  setPage(next.dataset.page);
}

function populateSelect(selector, items, selected) {
  const select = $(selector);
  if (!select) return;
  select.innerHTML = items.map((item) => `<option value="${escapeHtml(item.code)}">${escapeHtml(symbolLabel(item.code))}</option>`).join("");
  if (items.some((item) => item.code === selected)) select.value = selected;
}

function populateSymbolSelects() {
  const items = marketSymbols();
  populateSelect("#chart-symbol", items, state.symbol);
  populateSelect("#backtest-symbol", items, state.symbol);
  populateSelect("#order-symbol", items, state.symbol);
  const orderPrice = $("#order-price");
  if (orderPrice) orderPrice.value = currentQuote().price.toFixed(2);
}

function renderAll() {
  populateSymbolSelects();
  renderDashboard();
  renderScreener();
  renderChart();
  renderBacktest();
  renderTrade();
  renderRisk();
}

function renderDashboard() {
  const account = broker.snapshot(state.market, quoteMap());
  const ccy = account.currency;
  const totalPnl = account.totalPnl;
  $("#kpi-equity").textContent = money(account.equity, ccy);
  $("#kpi-equity-sub").textContent = `初始 ${money(account.initialCash, ccy)}`;
  $("#kpi-day").textContent = money(totalPnl, ccy);
  $("#kpi-day").className = `kpi ${tone(totalPnl)}`;
  $("#kpi-day-sub").textContent = "紙上帳本累計損益（非即時日損益）";
  $("#kpi-exposure").textContent = money(account.marketValue, ccy);
  $("#kpi-exposure-sub").textContent = `${Object.keys(account.positions).length} 檔持倉・不含未接即時行情`;
  const quotes = marketSymbols().map((item) => marketData.quote(item.code));
  const signals = quotes.filter((item) => Math.abs(item.pct) >= 2).length;
  $("#kpi-signal").textContent = `${signals} 個異動`;

  $("#heatmap").innerHTML = quotes.map((item) => {
    const meta = getSymbol(item.code);
    const hot = Math.abs(item.pct) >= 2 ? "hot" : "";
    const changeClass = item.pct > 0.05 ? "up" : item.pct < -0.05 ? "down" : "flat";
    const grow = Math.max(1, Math.sqrt(meta.cap) / 20);
    const tileSize = grow >= 50 ? "tile-xl" : grow >= 20 ? "tile-lg" : grow >= 8 ? "tile-md" : "tile-sm";
    return `<div class="tile ${tileSize} ${changeClass} ${hot}" data-open-symbol="${escapeHtml(item.code)}" title="${escapeHtml(meta.name)}"><div class="t-code">${escapeHtml(item.code)}</div><div class="t-chg">${pct(item.pct)}</div></div>`;
  }).join("");
  $$("[data-open-symbol]").forEach((tile) => tile.addEventListener("click", () => openSymbol(tile.dataset.openSymbol)));

  const favorites = loadFavorites(storage);
  $("#dashboard-watchlist tbody").innerHTML = quotes.map((item) => `<tr data-open-symbol="${escapeHtml(item.code)}"><td>${favButton(item.code, favorites)} <b>${escapeHtml(item.code)}</b> <span class="muted">${escapeHtml(getSymbol(item.code).name)}</span></td><td class="n">${fmtPrice(item.price, ccy)}</td><td class="n ${tone(item.pct)}">${pct(item.pct)}</td><td class="n">${volumeRatio(item.code).toFixed(2)}×</td></tr>`).join("");
  $$("#dashboard-watchlist [data-open-symbol]").forEach((row) => row.addEventListener("click", () => openSymbol(row.dataset.openSymbol)));
  bindFavButtons("#dashboard-watchlist", renderDashboard);

  const up = quotes.filter((item) => item.pct > 0).length;
  const down = quotes.filter((item) => item.pct < 0).length;
  const flat = quotes.length - up - down;
  $("#breadth").innerHTML = [
    ["上漲", up, "up"], ["下跌", down, "down"], ["持平", flat, "neutral"],
  ].map(([label, value, cls]) => `<div><span class="muted fs-12">${escapeHtml(label)}</span><div class="kpi ${cls}">${value}</div></div>`).join("");
  renderAudit("#dashboard-audit");
  a11yOpenSymbols();
}

function favButton(code, favorites) {
  const active = favorites.includes(code);
  return `<button class="fav" type="button" data-fav="${escapeHtml(code)}" aria-pressed="${active}" aria-label="${active ? "移除自選" : "加入自選"}">${active ? "★" : "☆"}</button>`;
}

function bindFavButtons(rootSelector, rerender) {
  $$(`${rootSelector} [data-fav]`).forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    const code = button.dataset.fav;
    toggleFavorite(storage, code);
    rerender();
    document.querySelector(`${rootSelector} [data-fav="${CSS.escape(code)}"]`)?.focus();
  }));
}

function openSymbol(code) {
  const meta = getSymbol(code);
  if (!meta) return; // fail-closed：未知代號不切換頁面
  state.symbol = code;
  state.market = meta.market;
  $$("[data-market]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.market === state.market)));
  populateSymbolSelects();
  auditEvent("SYMBOL_SELECTED", { symbol: code });
  setPage("chart");
}

function renderChart() {
  const meta = getSymbol(state.symbol);
  const q = currentQuote();
  const bars = marketData.getBars(state.symbol);
  const closes = bars.map((bar) => bar.c);
  const rsiValues = rsi(closes, 14);
  const lastRsi = rsiValues.at(-1);
  const high52 = Math.max(...closes), low52 = Math.min(...closes);
  $("#quote-head").innerHTML = [
    ["最新價", `${meta.ccy} ${fmtPrice(q.price)}`, "neutral"],
    ["日變化", pct(q.pct), tone(q.pct)],
    ["52 日區間", `${fmtPrice(low52)} — ${fmtPrice(high52)}`, "neutral"],
    ["量比／RSI", `${volumeRatio(state.symbol).toFixed(2)}× / ${lastRsi.toFixed(1)}`, lastRsi < 30 ? "up" : lastRsi > 70 ? "down" : "neutral"],
  ].map(([label, value, cls]) => `<article class="card"><h2>${label}</h2><div class="kpi ${cls}">${value}</div></article>`).join("");
  const chart = $("#price-chart");
  if (chart && (state.page === "chart" || chart.closest(".active"))) drawCandles(chart, bars, { window: Number($("#chart-window").value || state.chartWindow) });
  $("#technical-readings").innerHTML = `<div class="row"><span>MA20</span><span class="mono">${fmtPrice(avgLast(closes, 20))}</span></div><div class="row"><span>MA50</span><span class="mono">${fmtPrice(avgLast(closes, 50))}</span></div><div class="row"><span>RSI(14)</span><span class="badge ${lastRsi < 30 ? "up" : lastRsi > 70 ? "down" : "neutral"}">${lastRsi.toFixed(2)}</span></div><div class="row"><span>成交量</span><span class="mono">${fmtInt(q.vol)}</span></div>`;
}

// 主圖 hover：十字線＋OHLC 提示只做 pointer 增強；同樣資料表格本來就有。
function bindChartHover() {
  const chart = $("#price-chart");
  if (!chart || chart.dataset.hoverBound) return;
  chart.dataset.hoverBound = "1";
  chart.addEventListener("mousemove", (event) => {
    const rect = chart.getBoundingClientRect();
    const bars = marketData.getBars(state.symbol);
    const window = Number($("#chart-window").value || state.chartWindow);
    const hit = candleHoverAt(bars, Math.max(320, Math.floor(rect.width || 720)), event.clientX - rect.left, { window });
    drawCandles(chart, bars, { window, hover: hit ? hit.index : null });
  });
  chart.addEventListener("mouseleave", () => renderChart());
}

function renderScreener() {
  const minChange = Number($("#filter-change").value ?? -99);
  const maxPe = Number($("#filter-pe").value ?? 999);
  const minVolume = Number($("#filter-volume").value ?? 0);
  const rows = marketSymbols().map((meta) => ({ meta, quote: marketData.quote(meta.code), volume: volumeRatio(meta.code) })).filter((row) => row.quote.pct >= minChange && row.meta.pe <= maxPe && row.volume >= minVolume);
  $("#screen-count").textContent = `${rows.length} / ${marketSymbols().length} 個標的符合`;
  const favs = loadFavorites(storage);
  const screenerBody = rows.length ? rows.map(({ meta, quote: q, volume }) => `<tr data-open-symbol="${escapeHtml(meta.code)}"><td>${favButton(meta.code, favs)}</td><td><b>${escapeHtml(meta.code)}</b> <span class="muted">${escapeHtml(meta.name)}</span></td><td><span class="badge neutral">${escapeHtml(meta.market)}</span></td><td class="n">${fmtPrice(q.price, meta.ccy)}</td><td class="n ${tone(q.pct)}">${pct(q.pct)}</td><td class="n">${volume.toFixed(2)}×</td><td class="n">${meta.pe.toFixed(1)}×</td><td class="n">${meta.yield.toFixed(1)}%</td><td><span class="badge ${q.pct > 2 ? "up" : q.pct < -2 ? "down" : "neutral"}">${q.pct > 2 ? "動能" : q.pct < -2 ? "觀察風險" : "中性"}</span></td></tr>`).join("") : stateRow(9, "empty", "沒有符合條件的標的", "放寬日變化、本益比或量比條件後再試一次。");
  $("#screener-table tbody").innerHTML = screenerBody;
  $$("#screener-table [data-open-symbol]").forEach((row) => row.addEventListener("click", () => openSymbol(row.dataset.openSymbol)));
  bindFavButtons("#screener-table", renderScreener);
  a11yOpenSymbols();
}

function renderBacktest() {
  const select = $("#backtest-symbol");
  if (select) state.symbol = select.value || state.symbol;
  const strategy = $("#backtest-strategy").value;
  const research = isResearchStrategy(strategy);
  $("#backtest-legacy-ma").hidden = research;
  $("#backtest-legacy-slow").hidden = research;
  $("#backtest-research-alloc").hidden = !research;
  if (research) {
    renderResearchBacktest(strategy);
    return;
  }
  const options = {
    initialCapital: Number($("#backtest-capital").value) || 1_000_000,
    fast: Number($("#backtest-fast").value) || 20,
    slow: Number($("#backtest-slow").value) || 50,
    commissionRate: (Number($("#backtest-commission").value) || 0) / 100,
    slippageBps: Number($("#backtest-slippage").value) || 0,
  };
  let result;
  try { result = runBacktest(marketData.getBars(state.symbol), strategy, options); }
  catch (error) {
    $("#backtest-metrics").innerHTML = statePanel("error", "回測無法執行", error.message);
    $("#backtest-assumptions").innerHTML = statePanel("error", "模型假設不可用", "修正輸入參數後重新執行。");
    $("#backtest-trades tbody").innerHTML = stateRow(7, "error", "沒有成交明細", "回測尚未產生可解釋的結果。");
    const canvas = $("#equity-chart");
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  const m = result.metrics;
  $("#backtest-metrics").innerHTML = [
    ["淨損益", money(m.netProfit, getSymbol(state.symbol).ccy), tone(m.netProfit)],
    ["最大回撤", `${m.maxDrawdownPct.toFixed(2)}%`, "down"],
    ["勝率／交易數", m.tradeCount ? `${m.winRate.toFixed(1)}% / ${m.tradeCount}` : "N/A・無交易", "neutral"],
    ["Sharpe", m.sharpeInsufficient ? "樣本不足" : formatMetric(m.sharpe), m.sharpeInsufficient ? "neutral" : m.sharpe >= 1 ? "up" : "neutral"],
  ].map(([label, value, cls]) => `<article class="card"><h2>${label}</h2><div class="kpi ${cls}">${value}</div></article>`).join("");
  drawLine($("#equity-chart"), result.equity, { color: "#855bfb", baseline: options.initialCapital });
  $("#backtest-assumptions").innerHTML = `<div class="row"><span>策略</span><span>${escapeHtml(STRATEGIES[strategy] ?? strategy)}</span></div><div class="row"><span>成交</span><span>立即紙上模擬成交</span></div><div class="row"><span>手續費</span><span>${(options.commissionRate * 100).toFixed(4)}%</span></div><div class="row"><span>滑價</span><span>${options.slippageBps} bp</span></div><div class="row"><span>Sharpe</span><span>risk-free ${((result.assumptions.riskFreeRate ?? 0) * 100).toFixed(2)}%・樣本 ${m.sharpeSamples}/${result.assumptions.minSharpeSamples}${m.sharpeInsufficient ? "・不足不採信" : ""}</span></div><div class="row"><span>資料</span><span>固定 250 根模擬日 K・${escapeHtml(dataProvenanceTag())}</span></div>`;
  $("#backtest-trades tbody").innerHTML = result.trades.length ? result.trades.map((trade) => `<tr><td>${fmtDay(trade.entryTime)}</td><td>${fmtDay(trade.exitTime)}</td><td class="n">${trade.qty}</td><td class="n">${fmtPrice(trade.entryPrice)}</td><td class="n">${fmtPrice(trade.exitPrice)}</td><td class="n ${tone(trade.netPnl)}">${signed(trade.netPnl)}</td><td><span class="badge neutral">${trade.exitReason === "end" ? "資料結束" : "訊號"}</span></td></tr>`).join("") : stateRow(7, "empty", "此參數組合沒有完成交易", "不要把零交易誤當成低風險；調整策略或檢查樣本。");
}

function researchCosts() {
  return {
    commissionRate: (Number($("#backtest-commission").value) || 0) / 100,
    slippageBps: Number($("#backtest-slippage").value) || 0,
    initialCapital: Number($("#backtest-capital").value) || 1_000_000,
  };
}

function researchAllocate(def, frac) {
  return def.id === "buyHold" ? fullNotional() : fixedFraction(frac);
}

/* 分層研究回測渲染：IS／OOS 分開跑、分開顯示；展示用全樣本曲線只加 OOS 分界線。 */
function renderResearchBacktest(strategyId) {
  const def = researchDef(strategyId);
  const costs = researchCosts();
  const frac = Math.min(1, Math.max(0.01, Number($("#backtest-allocate").value) || 0.25));
  const bars = marketData.getBars(state.symbol);
  const ccy = getSymbol(state.symbol).ccy;
  let split;
  try {
    split = splitIS_OOS(bars, 0.4);
  } catch (error) {
    $("#backtest-metrics").innerHTML = statePanel("error", "無 OOS 資料", error.message);
    $("#backtest-assumptions").innerHTML = statePanel("error", "模型假設不可用", "資料不足以切出樣本內／外區間。");
    $("#backtest-trades tbody").innerHTML = stateRow(7, "error", "沒有成交明細", "先補足研究資料。");
    return;
  }
  const runOpts = { symbol: state.symbol, strategy: def, allocate: researchAllocate(def, frac), ...costs };
  const isS = summarizeResearch(evaluateWindow({ ...runOpts, contextBars: [], evalBars: split.is }), {});
  const oosS = summarizeResearch(evaluateWindow({ ...runOpts, contextBars: warmupTail(split.is, def.warmup), evalBars: split.oos }), {});
  const full = runResearchBacktest({ ...runOpts, bars });
  const bench = {};
  for (const id of ["cash", "buyHold"]) {
    const base = registry.get(id);
    bench[id] = summarizeResearch(runResearchBacktest({ symbol: state.symbol, strategy: base, allocate: researchAllocate(base, frac), bars, ...costs }), {});
  }
  $("#backtest-metrics").innerHTML = [
    ["OOS 淨損益", money(oosS.netProfit, ccy), tone(oosS.netProfit)],
    ["OOS Sharpe", na(oosS.sharpe, (v) => formatMetric(v)), oosS.sharpe === null ? "neutral" : "neutral"],
    ["OOS 最大回撤", `${oosS.maxDrawdownPct.toFixed(2)}%`, "down"],
    ["IS 淨損益（對照）", money(isS.netProfit, ccy), tone(isS.netProfit)],
  ].map(([label, value, cls]) => `<article class="card"><h2>${label}</h2><div class="kpi ${cls}">${value}</div></article>`).join("");
  const canvas = $("#equity-chart");
  drawLine(canvas, full.equity, { color: "#855bfb", baseline: costs.initialCapital, oosStart: split.is.length });
  $("#backtest-assumptions").innerHTML = [
    ["策略", `${escapeHtml(def.name)} ${escapeHtml(def.version)}`],
    ["假說", escapeHtml(def.hypothesis)],
    ["暖機", `${def.warmup} 根（含 warmup 前不交易）`],
    ["成交", "立即紙上模擬成交（next-bar-open）"],
    ["配置", def.id === "buyHold" ? "全額 buy&hold 基準" : `固定比例 ${(frac * 100).toFixed(0)}%（Portfolio 層決定，策略不碰股數）`],
    ["手續費／滑價", `${(costs.commissionRate * 100).toFixed(4)}%／${costs.slippageBps} bp`],
    ["IS／OOS", `${split.is.length}／${split.oos.length} 根（時序切分，OOS 為後段）`],
    ["基準比較", `Cash ${money(bench.cash.netProfit, ccy)}・Buy&Hold ${money(bench.buyHold.netProfit, ccy)}（同資金同成本）`],
    ["費用合計", `手續費 ${money(full.totalFees, ccy)}・滑價 ${money(full.totalSlippage, ccy)}`],
    ["資料", `固定 250 根模擬日 K・${dataProvenanceTag()}`],
  ].map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("");
  const isLen = split.is.length;
  $("#backtest-trades tbody").innerHTML = full.trades.length ? full.trades.map((trade) => {
    const tag = trade.entrySignalIndex >= isLen ? "OOS・" : "IS・";
    return `<tr><td>${fmtDay(trade.entryTime)}</td><td>${fmtDay(trade.exitTime)}</td><td class="n">${trade.qty}</td><td class="n">${fmtPrice(trade.entryPrice)}</td><td class="n">${fmtPrice(trade.exitPrice)}</td><td class="n ${tone(trade.netPnl)}">${signed(trade.netPnl)}</td><td><span class="badge neutral">${tag}${trade.exitReason === "end" ? "資料結束" : "訊號"}</span></td></tr>`;
  }).join("") : stateRow(7, "empty", "此策略在全樣本沒有完成交易", "零交易不是低風險；先檢查暖機與訊號。");
  renderResearchProvenance();
}

/* Warmup context：評估窗之前的最近 N 根（策略宣告的記憶長度），只供指標歷史，不計績效。 */
function warmupTail(bars, warmup) {
  const n = Math.max(0, Math.floor(warmup) || 0);
  if (!n || !Array.isArray(bars)) return [];
  return bars.slice(-Math.min(n, bars.length));
}

/* 策略中心：基準永遠同場比較；gate 只評研究策略；不自動晉升任何策略。 */
function runStrategyComparison() {
  const bars = marketData.getBars(state.symbol);
  const costs = researchCosts();
  const ccy = getSymbol(state.symbol).ccy;
  const tbody = $("#strategy-table tbody");
  let split;
  let windows;
  try {
    split = splitIS_OOS(bars, 0.4);
    windows = walkForward(bars, { folds: 3, minWindow: 30 });
  } catch (error) {
    tbody.innerHTML = stateRow(10, "error", "策略比較無法執行", error.message);
    return;
  }
  const surfaceCells = [10, 20, 30].map((short) => {
    const variant = makeTrendStrategy({ id: `trend-s${short}`, short });
    const result = runResearchBacktest({ symbol: state.symbol, strategy: variant, allocate: fixedFraction(0.25), bars, ...costs });
    return { params: { short }, value: summarizeResearch(result, {}).netProfit };
  });
  const surface = parameterSurface(surfaceCells);
  const surfaceFlag = surface.overfitRisk ? "OVERFIT_RISK" : "STABLE";
  const rows = ["cash", "buyHold", "multiHorizonTrend"].map((id) => {
    const def = registry.get(id);
    const runOpts = { symbol: state.symbol, strategy: def, allocate: researchAllocate(def, 0.25), ...costs };
    const isS = summarizeResearch(evaluateWindow({ ...runOpts, contextBars: [], evalBars: split.is }), {});
    const oosS = summarizeResearch(evaluateWindow({ ...runOpts, contextBars: warmupTail(split.is, def.warmup), evalBars: split.oos }), {});
    const stress = runCostStress({ ...runOpts, bars }, (r) => summarizeResearch(r, {}), id === "multiHorizonTrend" ? [0.5, 1, 2, 3] : [1, 2]);
    const oosWindows = windows.map((w) => summarizeResearch(evaluateWindow({ ...runOpts, contextBars: warmupTail(w.train, def.warmup), evalBars: w.test }), {}));
    const gate = id === "multiHorizonTrend"
      ? evaluatePromotion({ strategyId: id, isSummary: isS, oosSummaries: oosWindows, costStress: stress, surfaceFlag, correctnessFindings: [] })
      : null;
    return { def, isS, oosS, stress, gate };
  });
  tbody.innerHTML = rows.map(({ def, isS, oosS, stress, gate }) => `<tr><td><b>${escapeHtml(def.name)}</b><br><span class="muted fs-11">${escapeHtml(def.hypothesis.slice(0, 28))}…</span></td><td><span class="badge neutral">DRAFT</span></td><td class="n ${tone(isS.netProfit)}">${signed(isS.netProfit)}</td><td class="n ${tone(oosS.netProfit)}">${signed(oosS.netProfit)}</td><td class="n">${na(oosS.sharpe, (v) => v.toFixed(2))}</td><td class="n">${oosS.maxDrawdownPct.toFixed(2)}%</td><td class="n">${(oosS.turnover * 100).toFixed(1)}%</td><td class="n">${oosS.tradeCount}</td><td>${stress.fragile ? '<span class="badge down">EXECUTION_FRAGILE</span>' : '<span class="badge up">成本穩</span>'}</td><td>${gate === null ? '<span class="muted">基準不參評</span>' : gate.pass ? '<span class="badge up">GATE PASS</span>' : '<span class="badge down">GATE FAIL</span>'}</td></tr>`).join("");
  const trend = rows.find((r) => r.def.id === "multiHorizonTrend");
  $("#strategy-gate").innerHTML = trend.gate.checks.map((c) => `<div class="row"><span>${c.pass ? "✓" : "✗"} ${escapeHtml(c.id)}</span><span>${escapeHtml(c.detail)}</span></div>`).join("") + `<div class="row"><span>晉升</span><span>需人工決策；本頁不自動啟用 paper</span></div>`;
  $("#research-robustness").innerHTML = [
    `<div class="row"><span>參數平面（short 10／20／30）</span><span>${escapeHtml(surface.detail)}</span></div>`,
    `<div class="row"><span>平面判定</span><span>${surface.flag ?? "STABLE 高原"}</span></div>`,
    ...trend.stress.runs.map((r) => `<div class="row"><span>成本 ${r.mult}×</span><span>淨損益 ${signed(r.summary.netProfit)}・Sharpe ${na(r.summary.sharpe, (v) => v.toFixed(2))}・MDD ${r.summary.maxDrawdownPct.toFixed(1)}%・${r.summary.tradeCount} 筆</span></div>`),
  ].join("");
  renderResearchProvenance();
  auditEvent("STRATEGY_COMPARE", { symbol: state.symbol, surface: surface.flag ?? "STABLE" });
}

function renderResearchProvenance() {
  const element = $("#research-provenance");
  if (!element) return;
  const source = marketData.getSource();
  const described = typeof marketData.describe === "function" ? marketData.describe() : null;
  const timezone = state.market === "TW" ? "Asia/Taipei" : "America/New_York";
  element.innerHTML = [
    ["來源", `${source.name}・${source.kind}`],
    ["數據種類", described?.dataKind ?? "simulation"],
    ["狀態", described?.status ?? "READY"],
    ["正規化", `v${described?.normalizationVersion ?? 1}`],
    ["資料集", `固定 250 根模擬日 K・${dataProvenanceTag()}`],
    ["週期", "日 K（daily OHLCV）"],
    ["時區", timezone],
    ["更新", source.updatedAt],
    ["新鮮度", "非即時・研究用"],
    ["point-in-time", described?.pointInTime ?? "unknown"],
    ["公司行動調整", "unknown（未標記，不假裝已調整）"],
  ].map(([k, v]) => `<div class="row"><span>${k}</span><span>${escapeHtml(v)}</span></div>`).join("");
}

/* 研究假設用的機器可讀來源標籤：兩次不同 provenance 的回測不再看起來相同。 */
function dataProvenanceTag() {
  const described = typeof marketData.describe === "function" ? marketData.describe() : null;
  if (!described) return "simulation";
  return `${described.provider}・${described.dataKind}・norm-v${described.normalizationVersion}`;
}

/* Fugle 真實行情（7B2）：明確模式＋async 查詢＋失敗顯性，永不 fallback 模擬。 */
const FUGLE_ERROR_TEXT = {
  AUTH_REQUIRED: "proxy 未設定金鑰（fail closed），請部署者檢查 server env",
  AUTH_FAILED: "Fugle 認證失敗（key 無效或方案不足）",
  RATE_LIMITED: "觸發限流，稍後再試",
  TIMEOUT: "請求逾時（10s 硬上限）",
  PROVIDER_UNAVAILABLE: "Fugle 或 proxy 暫時不可用",
  INVALID_SYMBOL: "商品代碼不正確（Fugle 查無）",
  DATA_INVALID: "Fugle 回應結構異常（schema drift 可能）",
  DATA_STALE: "報價已 stale，不採用",
  UNSUPPORTED_CAPABILITY: "不支援的操作",
  INSUFFICIENT_RESEARCH_HISTORY: "真實 K 棒不足（需 ≥150 根），不補模擬資料",
  FUGLE_MODE_OFF: "目前是模擬模式",
  PROXY_NOT_CONFIGURED: "Fugle mode unavailable：尚未設定 proxy URL",
};

function requireFugleAdapter() {
  if (state.dataMode !== "fugle-proxy") {
    throw Object.assign(new Error("切換「Fugle 真實行情」後再查詢"), { code: "FUGLE_MODE_OFF" });
  }
  if (!MARKET_DATA_PROXY_URL) {
    throw Object.assign(new Error("部署時注入 proxy URL 後可用"), { code: "PROXY_NOT_CONFIGURED" });
  }
  return new FugleProxyAdapter({ baseUrl: MARKET_DATA_PROXY_URL });
}

function renderFugleError(box, error) {
  const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
  const hint = FUGLE_ERROR_TEXT[code] ?? "未知錯誤";
  const extra = error && error.message ? `（${error.message}）` : "";
  box.innerHTML = statePanel("error", `Fugle 查詢失敗［${code}］`, `${hint}${extra}維持 Fugle 模式，不切回模擬。`);
}

function fmtTaipeiTime(ts) {
  if (!Number.isFinite(ts)) return "未知";
  return new Date(ts).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function taipeiYMD(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function renderFugleQuote() {
  const box = $("#fugle-quote");
  const show = $("#fugle-symbol").value.trim() || "2330";
  box.innerHTML = statePanel("loading", "查詢真實報價…", `${show}・Fugle intraday quote`);
  try {
    const adapter = requireFugleAdapter();
    const envelope = await adapter.quoteAsync(show);
    const q = envelope.data;
    const m = envelope.meta;
    const session = getCurrentSession("TW", Date.now());
    const freshBadge = m.stale
      ? `<span class="badge down">STALE</span>`
      : m.freshnessStatus === "FRESH" ? `<span class="badge up">FRESH</span>` : `<span class="badge neutral">UNKNOWN</span>`;
    const rows = [
      ["標的", `${escapeHtml(q.symbol)}・TW・<span class="badge brand">REAL DATA</span>`],
      ["最新價", `<span class="mono">${fmtPrice(q.price)}</span>`],
      ["前收", `<span class="mono">${q.previousClose === null ? "N/A" : fmtPrice(q.previousClose)}</span>`],
      ["漲跌", `<span class="mono">${q.change === null ? "N/A" : signed(q.change)}</span>`],
      ["漲跌幅", `<span class="mono">${q.changePct === null ? "N/A" : pct(q.changePct)}</span>`],
      ["成交量", `<span class="mono">${q.volume === null ? "N/A" : fmtInt(q.volume)}</span>`],
      ["Provider 時間", fmtTaipeiTime(q.timestamp)],
      ["收到時間", fmtTaipeiTime(m.receivedAt)],
      ["Freshness", `${m.freshnessStatus} ${freshBadge}`],
      ["交易時段", session ? session.name : "休市"],
      ["Provider 狀態", adapter.getStatus().state],
    ];
    box.innerHTML = `<div class="notice info">真實報價僅供研究參考；下單票價格仍為模擬，執行永遠是 PAPER。</div>` +
      rows.map(([k, v]) => `<div class="row"><span>${k}</span><span>${v}</span></div>`).join("");
    auditEvent("FUGLE_QUOTE", { symbol: q.symbol, freshness: m.freshnessStatus });
  } catch (error) {
    renderFugleError(box, error);
  }
}

async function runFugleResearch() {
  const box = $("#fugle-research");
  box.innerHTML = statePanel("loading", "抓取真實日 K…", "Fugle historical candles（<1 日曆年）→ Multi-Horizon Trend");
  try {
    const adapter = requireFugleAdapter();
    const symbol = $("#fugle-symbol").value.trim() || "2330";
    const to = taipeiYMD(new Date());
    const { from } = fugleResearchRange({ to });
    const { envelope } = await adapter.getBarsAsync(symbol, { from, to });
    if (envelope.meta.provider !== "FUGLE") throw Object.assign(new Error("provenance 非 FUGLE，拒絕混用"), { code: "DATA_INVALID" });
    const bars = envelope.data;
    if (!Array.isArray(bars) || bars.length < 150) {
      box.innerHTML = statePanel("error", "INSUFFICIENT_RESEARCH_HISTORY", `真實 K 棒僅 ${Array.isArray(bars) ? bars.length : 0} 根（需 ≥150 根），不補模擬資料。`);
      return;
    }
    const def = registry.get("multiHorizonTrend");
    const costs = researchCosts();
    const base = { symbol, strategy: def, allocate: researchAllocate(def, 0.25), ...costs };
    const split = splitIS_OOS(bars, 0.4);
    const isR = evaluateWindow({ ...base, contextBars: [], evalBars: split.is });
    const oosR = evaluateWindow({ ...base, contextBars: warmupTail(split.is, def.warmup), evalBars: split.oos });
    const isS = summarizeResearch(isR, {});
    const oosS = summarizeResearch(oosR, {});
    const windows = walkForward(bars, { folds: 3, minWindow: 30 })
      .map((w) => ({ ...w, start: w.train.length }))
      .filter((w) => w.start >= def.warmup);
    if (!windows.length) {
      box.innerHTML = statePanel("error", "INSUFFICIENT_RESEARCH_HISTORY", "walk-forward 無可用窗口（context 不足 warmup），不硬算。");
      return;
    }
    const oosWindows = windows.map((w) => summarizeResearch(evaluateWindow({ ...base, contextBars: warmupTail(w.train, def.warmup), evalBars: w.test }), {}));
    const buy = registry.get("buyHold");
    const buyOOS = summarizeResearch(evaluateWindow({ symbol, strategy: buy, allocate: researchAllocate(buy, 0.25), contextBars: [], evalBars: split.oos, ...costs }), {});
    const stress = runCostStress({ ...base, bars }, (r) => summarizeResearch(r, {}), [1, 2]);
    const surfaceCells = evaluateTrendSurface({ symbol, bars, shorts: [10, 20, 30], evalLength: 60, makeVariant: (short) => makeTrendStrategy({ id: `trend-s${short}`, short }), allocate: fixedFraction(0.25), ...costs });
    const surface = parameterSurface(surfaceCells);
    const gate = evaluatePromotion({ strategyId: def.id, isSummary: isS, oosSummaries: oosWindows, costStress: stress, surfaceFlag: surface.overfitRisk ? "OVERFIT_RISK" : "STABLE", correctnessFindings: [] });
    const last = def.generateSignal({ bars, index: bars.length - 1, symbol });
    const m = envelope.meta;
    const provenance = `${m.provider}・${m.dataKind}・norm-v${m.normalizationVersion}・${m.adjustmentMode}・${m.pointInTime}`;
    const row = (k, v) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
    box.innerHTML = `<div class="notice info">真實資料研究 <span class="badge brand">FUGLE HISTORICAL</span> <span class="badge neutral">PAPER EXECUTION</span></div>` +
      row("資料", `${escapeHtml(symbol)}・${m.dataKind}・${bars.length} 根`) +
      row("區間", `${escapeHtml(String(bars[0].t ? fmtDay(bars[0].t) : "?"))} → ${escapeHtml(fmtDay(bars.at(-1).t))}`) +
      row("策略", "Multi-Horizon Trend 20/60/120") +
      row("最新 score", na(last.score, (v) => v.toFixed(3))) +
      row("最新 confidence", na(last.confidence, (v) => v.toFixed(3))) +
      row("最新 reason", escapeHtml(last.reasonCodes?.[0] ?? "未知")) +
      row("診斷 S/M/L", escapeHtml([last.diagnostics?.short, last.diagnostics?.medium, last.diagnostics?.long].map((v) => v ?? "?").join(" / "))) +
      row("IS 報酬／Sharpe／MDD／筆數", `${signed(isS.netProfit)}／${na(isS.sharpe, (v) => v.toFixed(2))}／${isS.maxDrawdownPct.toFixed(2)}%／${isS.tradeCount}`) +
      row("OOS 報酬／Sharpe／MDD／筆數", `${signed(oosS.netProfit)}／${na(oosS.sharpe, (v) => v.toFixed(2))}／${oosS.maxDrawdownPct.toFixed(2)}%／${oosS.tradeCount}`) +
      row("Buy&Hold OOS", `${signed(buyOOS.netProfit)}（同資料同區間）`) +
      row("Walk-forward", oosWindows.map((s, i) => `W${i + 1} ${signed(s.netProfit)}`).join("・") || "無可用窗口") +
      row("成本壓力", stress.fragile ? "EXECUTION_FRAGILE" : "成本穩") +
      row("參數穩健", surface.overfitRisk ? "OVERFIT_RISK" : "STABLE 高原") +
      row("Promotion Gate", gate.pass ? "GATE PASS" : "GATE FAIL") +
      row("Provenance", escapeHtml(`${provenance}・${from}→${to}`));
    auditEvent("FUGLE_RESEARCH", { symbol, bars: bars.length, range: `${from}→${to}`, gate: gate.pass ? "PASS" : "FAIL" });
  } catch (error) {
    renderFugleError(box, error);
  }
}

function renderTrade() {
  const market = $("#trade-market").value || state.market;
  if (market !== state.market) state.market = market;
  const account = broker.snapshot(market, quoteMap(market));
  const meta = getSymbol($("#order-symbol").value || state.symbol);
  $("#account-summary").innerHTML = `<div class="row"><span>帳戶模式</span><span class="badge brand">PAPER</span></div><div class="row"><span>可用現金</span><span>${money(account.cash, account.currency)}</span></div><div class="row"><span>持倉市值</span><span>${money(account.marketValue, account.currency)}</span></div><div class="row"><span>權益</span><span>${money(account.equity, account.currency)}</span></div><div class="row"><span>已實現／未實現</span><span>${money(account.realizedPnl, account.currency)} ／ ${money(account.unrealizedPnl, account.currency)}</span></div><div class="row"><span>本 session 損益</span><span class="${tone(account.dailyPnl)}">${money(account.dailyPnl, account.currency)} (${account.sessionKey})</span></div>`;
  $("#positions-table tbody").innerHTML = Object.values(account.positions).length ? Object.values(account.positions).map((position) => `<tr><td><b>${escapeHtml(position.symbol)}</b></td><td class="n">${position.qty}</td><td class="n">${fmtPrice(position.avgCost)}</td><td class="n">${fmtPrice(position.last)}</td><td class="n ${tone(position.unrealized)}">${signed(position.unrealized)}</td></tr>`).join("") : stateRow(5, "empty", "尚無持倉", "紙上帳戶從零開始，不會自動載入券商資料。");
  $("#orders-table tbody").innerHTML = account.orders.length ? account.orders.map((order) => `<tr><td>${escapeHtml(order.timestamp)}</td><td>${escapeHtml(order.symbol)}</td><td class="${order.side === "buy" ? "up" : "down"}">${order.side === "buy" ? "買進" : "賣出"}</td><td class="n">${order.qty}</td><td class="n">${fmtPrice(order.price)}</td><td><span class="badge up">已成交・PAPER</span></td></tr>`).join("") : stateRow(6, "empty", "尚無訂單", "建立紙上訂單後，這裡會保留本機歷史。");
  updateOrderPrice();
  updateOrderEstimate();
}

function updateOrderEstimate() {
  const box = $("#order-estimate");
  if (!box) return;
  const market = $("#trade-market").value || state.market;
  const qty = Number($("#order-qty").value);
  const price = Number($("#order-price").value);
  const account = broker.snapshot(market, quoteMap(market));
  const estimate = orderEstimate({ qty, price, equity: account.equity });
  if (!estimate) {
    box.textContent = "輸入數量與價格後顯示試算（僅供參考，不代表風控結果）。";
    return;
  }
  const lot = market === "TW" ? (qty >= 1000 ? "整股" : "零股") : "美股";
  const overCap = estimate.equityPct > 20 ? "・超過單筆 20% 上限，預覽不會通過" : "";
  box.textContent = `試算：名目 ${fmtPrice(estimate.notional)}・預估手續費 ${fmtPrice(estimate.estFee)}・佔權益 ${estimate.equityPct.toFixed(2)}%・${lot}・可用 ${money(account.cash, account.currency)}${overCap}（送出前仍須預覽＋二次確認）`;
}

function updateOrderPrice() {
  const select = $("#order-symbol");
  if (!select) return;
  const meta = getSymbol(select.value);
  const price = currentQuote(meta.code).price;
  const input = $("#order-price");
  if (document.activeElement !== input) input.value = price.toFixed(2);
}

function previewOrder(event) {
  event?.preventDefault();
  const market = $("#trade-market").value;
  const symbol = $("#order-symbol").value;
  const side = $("#order-side").value;
  const qty = Number($("#order-qty").value);
  const price = Number($("#order-price").value);
  const account = broker.snapshot(market, quoteMap(market));
  const lot = $("#order-lot").value || (market === "TW" ? "oddLot" : "regular");
  const candidate = { market, symbol, side, qty, price, lot, clientOrderId: nextClientOrderId() };
  let decision;
  const box = $("#order-risk");
  if (!permissionsFor(state.role).includes("paper:order")) {
    decision = { ok: false, code: "ROLE_DENIED", reason: "目前角色是觀察者；切換 Trader 才能建立紙上訂單" };
    box.className = "notice";
    box.innerHTML = statePanel("permission", "觀察者角色無法下單", "切換為 Trader 後再按預覽；所有紙上訂單只寫本機帳本，不會送往交易所。");
  } else {
    decision = risk.approveOrder(account, candidate);
    box.className = `notice ${decision.ok ? "info" : ""}`;
    box.textContent = `${decision.ok ? "通過" : "拒絕"}［${decision.code}］${decision.reason}`;
  }
  $("#order-submit").disabled = !decision.ok;
  state.pendingOrder = decision.ok ? candidate : null;
  if (decision.ok) openOrderModal(candidate, account);
  auditEvent(decision.ok ? "ORDER_PREVIEW_APPROVED" : "ORDER_PREVIEW_REJECTED", { symbol, side, qty, price, code: decision.code });
}

function openOrderModal(order, account) {
  state.modalTrigger = document.activeElement;
  $("#order-modal-body").innerHTML = `<div class="notice info">這是紙上帳本寫入，不會送往交易所。</div><div class="row"><span>市場／標的</span><span>${escapeHtml(order.market)}・${escapeHtml(symbolLabel(order.symbol))}</span></div><div class="row"><span>方向／數量</span><span>${order.side === "buy" ? "買進" : "賣出"}・${order.qty}・${order.lot === "regular" ? "整股" : "零股"}</span></div><div class="row"><span>模擬價格</span><span>${fmtPrice(order.price)}・名目 ${fmtPrice(order.price * order.qty)}</span></div><div class="row"><span>下單後現金</span><span>${money(account.cash - (order.side === "buy" ? order.price * order.qty : -order.price * order.qty), account.currency)}</span></div>`;
  const modal = $("#order-modal");
  modal.hidden = false;
  modal.classList.add("open");
  $("#order-confirm").focus();
}

function confirmOrder() {
  if (!state.pendingOrder) return;
  const pending = { ...state.pendingOrder };
  const result = executePaperOrder({
    broker,
    risk,
    order: pending,
    quotes: quoteMap(pending.market),
    canTrade: permissionsFor(state.role).includes("paper:order"),
    now: Date.now(),
  });
  if (!result.filled) {
    closeOrderModal();
    state.pendingOrder = null;
    $("#order-submit").disabled = true;
    $("#order-risk").className = "notice order-ack";
    $("#order-risk").textContent = `確認時拒絕［${result.decision.code}］${result.decision.reason}`;
    auditEvent("ORDER_CONFIRM_REJECTED", { symbol: pending.symbol, code: result.decision.code, reason: result.decision.reason });
    renderTrade();
    return;
  }
  const order = result.fill;
  auditEvent("ORDER_FILLED_PAPER", { orderId: order.id, symbol: order.symbol, side: order.side, qty: order.qty, price: order.price });
  closeOrderModal();
  state.pendingOrder = null;
  $("#order-risk").className = "notice info order-ack";
  $("#order-risk").textContent = `已寫入紙上帳本［${order.id}］；沒有真實券商副作用。`;
  $("#order-submit").disabled = true;
  renderAll();
}
function closeOrderModal() {
  closeModal($("#order-modal"));
}

function handleModalKeydown(event) {
  for (const id of ["#order-modal", "#help-modal"]) {
    const modal = $(id);
    if (!modal || modal.hidden || !modal.classList.contains("open")) continue;
    if (event.key === "Escape") {
      event.preventDefault();
      if (id === "#order-modal") state.pendingOrder = null;
      closeModal(modal);
      return;
    }
    if (event.key !== "Tab") continue;
    const focusable = [...modal.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])")];
    if (!focusable.length) continue;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

function closeModal(modal) {
  modal.classList.remove("open");
  modal.hidden = true;
  if (state.modalTrigger instanceof HTMLElement) state.modalTrigger.focus();
  state.modalTrigger = null;
}

function openHelp() {
  state.modalTrigger = document.activeElement;
  const modal = $("#help-modal");
  modal.hidden = false;
  modal.classList.add("open");
  $("#help-close").focus();
}

function closeHelp() {
  const modal = $("#help-modal");
  if (!modal || modal.hidden) return;
  closeModal(modal);
}

function openTicket(side) {
  setPage("trade");
  $("#order-side").value = side;
  updateOrderEstimate();
  $("#order-qty").focus();
}

/* 鍵盤可達性：div／tr 的 data-open-symbol 補 role＋tabindex；Enter／Space 啟動。 */
function a11yOpenSymbols() {
  $$("[data-open-symbol]").forEach((element) => {
    if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) return;
    if (!element.hasAttribute("tabindex")) element.setAttribute("tabindex", "0");
    if (!element.hasAttribute("role")) element.setAttribute("role", "button");
  });
}

function handleGlobalKeydown(event) {
  const target = event.target;
  if (target instanceof HTMLElement && target.hasAttribute("data-open-symbol")
    && !(target instanceof HTMLButtonElement) && !(target instanceof HTMLAnchorElement)
    && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openSymbol(target.dataset.openSymbol);
    return;
  }
  const active = document.activeElement;
  const tag = (active?.tagName || "").toLowerCase();
  const typing = ["input", "textarea", "select"].includes(tag) || Boolean(active?.isContentEditable);
  if (typing) return;
  if (event.key === "/") {
    event.preventDefault();
    $("#symbol-search").focus();
  } else if (event.key >= "1" && event.key <= "6") {
    setPage(PAGE_ORDER[Number(event.key) - 1]);
  } else if (event.key === "?") {
    openHelp();
  } else if (event.key === "b" || event.key === "B") {
    openTicket("buy");
  } else if (event.key === "s" || event.key === "S") {
    openTicket("sell");
  }
}

function handleSymbolSearch(event) {
  if (event.key !== "Enter") return;
  const query = event.target.value.trim().toLowerCase();
  if (!query) return;
  const hit = SYMBOLS.find((item) => item.code.toLowerCase() === query)
    ?? SYMBOLS.find((item) => item.code.toLowerCase().startsWith(query))
    ?? SYMBOLS.find((item) => item.name.includes(event.target.value.trim()));
  if (hit) {
    event.target.value = "";
    openSymbol(hit.code);
  }
}

function renderRisk(target = "#audit-log") {
  const status = risk.status();
  $("#risk-state").textContent = status.tripped ? "已凍結" : "運作中";
  $("#risk-state").className = `kpi ${status.tripped ? "down" : "up"}`;
  $("#risk-reason").textContent = status.reason || "所有紙上訂單仍需先經風控";
  const canManage = permissionsFor(state.role).includes("risk:trip");
  $("#kill-switch").disabled = !canManage || status.tripped;
  $("#reset-risk").disabled = !permissionsFor(state.role).includes("risk:reset") || !status.tripped;
  $("#permission-table").innerHTML = Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => `<div class="row"><span>${escapeHtml(role)}</span><span class="mono fs-11">${escapeHtml(permissions.join(" · "))}</span></div>`).join("");
  renderAudit(target);
}

function renderAudit(target = "#audit-log") {
  const element = $(target);
  if (!element) return;
  const entries = audit.list().slice(-40).reverse();
  element.innerHTML = entries.length ? entries.map((entry) => `<div><span class="t">${escapeHtml(entry.timestamp)}</span><b>${escapeHtml(entry.event)}</b> <span class="muted">${escapeHtml(JSON.stringify(entry.details))}</span></div>`).join("") : statePanel("empty", "尚無事件", "完成研究、風控或紙上操作後，這裡會留下 session audit。");
}

function downloadAudit() {
  const blob = new Blob([audit.toCSV()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "stock-lab-audit.csv"; link.click();
  URL.revokeObjectURL(url);
  auditEvent("AUDIT_EXPORTED", {});
}

function initEvents() {
  $$("[data-market]").forEach((button) => button.addEventListener("click", () => setMarket(button.dataset.market)));
  $$(".tabs [role=tab]").forEach((button) => {
    button.addEventListener("click", () => setPage(button.dataset.page));
    button.addEventListener("keydown", handleTabKeydown);
  });
  $("#role-select").addEventListener("change", (event) => { state.role = event.target.value; auditEvent("ROLE_CHANGED", { role: state.role }); renderAll(); });
  $("#chart-symbol").addEventListener("change", (event) => { state.symbol = event.target.value; renderChart(); });
  $("#chart-window").addEventListener("change", (event) => { state.chartWindow = Number(event.target.value); renderChart(); });
  bindChartHover();
  $("#screen-run").addEventListener("click", renderScreener);
  $("#screen-reset").addEventListener("click", () => { $("#filter-change").value = -99; $("#filter-pe").value = 999; $("#filter-volume").value = 0; renderScreener(); });
  $("#backtest-symbol").addEventListener("change", (event) => { state.symbol = event.target.value; renderBacktest(); });
  $("#backtest-run").addEventListener("click", () => { auditEvent("BACKTEST_RUN", { symbol: state.symbol, strategy: $("#backtest-strategy").value }); renderBacktest(); });
  $("#trade-market").addEventListener("change", (event) => { setMarket(event.target.value); $("#trade-market").value = event.target.value; });
  $("#order-symbol").addEventListener("change", () => { updateOrderPrice(); updateOrderEstimate(); });
  $("#order-qty").addEventListener("input", () => { $("#order-submit").disabled = true; updateOrderEstimate(); });
  $("#order-price").addEventListener("input", updateOrderEstimate);
  $("#order-preview").addEventListener("click", previewOrder);
  $("#order-form").addEventListener("submit", (event) => { event.preventDefault(); if (!state.pendingOrder) previewOrder(event); });
  $("#order-confirm").addEventListener("click", confirmOrder);
  $("#order-cancel").addEventListener("click", () => { state.pendingOrder = null; closeOrderModal(); });
  $("#kill-switch").addEventListener("click", () => { if (!permissionsFor(state.role).includes("risk:trip")) return; risk.trip("使用者手動啟動"); auditEvent("KILL_SWITCH_TRIPPED", {}); renderRisk(); });
  $("#reset-risk").addEventListener("click", () => { if (!permissionsFor(state.role).includes("risk:reset")) return; risk.reset(); auditEvent("KILL_SWITCH_RESET", {}); renderRisk(); });
  $("#export-audit").addEventListener("click", downloadAudit);
  $("#order-modal").addEventListener("click", (event) => { if (event.target.id === "order-modal") { state.pendingOrder = null; closeOrderModal(); } });
  $("#order-modal").addEventListener("keydown", handleModalKeydown);
  $("#help-modal").addEventListener("click", (event) => { if (event.target.id === "help-modal") closeHelp(); });
  $("#help-modal").addEventListener("keydown", handleModalKeydown);
  $("#help-close").addEventListener("click", closeHelp);
  $("#shortcut-help").addEventListener("click", openHelp);
  $("#symbol-search").addEventListener("keydown", handleSymbolSearch);
  $("#order-lot").addEventListener("change", updateOrderEstimate);
  $("#data-mode").addEventListener("change", (event) => {
    state.dataMode = event.target.value;
    auditEvent("DATA_MODE_CHANGED", { mode: state.dataMode });
    if (state.dataMode !== "fugle-proxy") {
      $("#fugle-quote").innerHTML = "切換「Fugle 真實行情」後可查詢；模擬模式不連外網。真實報價僅供研究參考，下單票價格仍為模擬。";
      $("#fugle-research").innerHTML = "";
    }
  });
  $("#fugle-quote-btn").addEventListener("click", renderFugleQuote);
  $("#fugle-research-btn").addEventListener("click", runFugleResearch);
  $("#backtest-strategy").addEventListener("change", renderBacktest);
  $("#strategy-run").addEventListener("click", runStrategyComparison);
  document.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("resize", () => { if (state.page === "chart") renderChart(); if (state.page === "backtest") renderBacktest(); });
}

function renderDataSource() {
  const source = marketData.getSource();
  const described = typeof marketData.describe === "function" ? marketData.describe() : null;
  const state = described?.status ?? "READY";
  const badge = $("#market-status");
  if (badge) {
    badge.textContent = state === "READY" ? source.shortLabel : `${source.shortLabel}・${state}`;
    badge.title = `${source.name}：${source.note}（${source.updatedAt}）`;
  }
  const label = $("#data-source");
  if (label) label.textContent = `${source.name}・${source.updatedAt}終點・非即時` + (described ? `・${described.dataKind}・${state}` : "");
}

auditEvent("SESSION_OPEN", { app: "Stock Lab" });
initEvents();
setPage(state.page);
renderDataSource();
renderAll();
