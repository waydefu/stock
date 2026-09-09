/* Stock Lab UI orchestration.
   介面層只組合資料、回測、風控與紙上 broker；沒有網路、秘密或真實下單副作用。 */
"use strict";

import { SYMBOLS, fmtDate, fmtInt, fmtPrice, getBars, getSymbol, quote, rsi, volumeRatio } from "./data.js";
import { drawCandles, drawLine } from "./charts.js";
import { formatMetric, runBacktest, STRATEGIES } from "./backtest.js";
import { MemoryStorage, PaperBroker } from "./paper.js";
import { AuditLog, DEFAULT_RISK, ROLE_PERMISSIONS, RiskEngine, permissionsFor } from "./risk.js";

const state = {
  market: "TW",
  role: "observer",
  symbol: "2330",
  page: "dashboard",
  chartWindow: 90,
  pendingOrder: null,
};

const storage = typeof localStorage === "undefined" ? new MemoryStorage() : localStorage;
const broker = new PaperBroker({ storage });
const risk = new RiskEngine(DEFAULT_RISK);
const audit = new AuditLog();
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const money = (value, currency) => `${currency} ${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (value, digits = 2) => `${value >= 0 ? "+" : ""}${Number(value).toFixed(digits)}`;
const pct = (value) => `${signed(value)}%`;
const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "neutral";
const symbolLabel = (code) => { const item = getSymbol(code); return item ? `${item.code} ${item.name}` : code; };

function marketSymbols() { return SYMBOLS.filter((item) => item.market === state.market); }
function currentQuote(code = state.symbol) { return quote(code); }
function quoteMap(market = state.market) {
  return Object.fromEntries(marketSymbolsFor(market).map((item) => [item.code, quote(item.code)]));
}
function marketSymbolsFor(market) { return SYMBOLS.filter((item) => item.market === market); }
function fmtDay(t) { return new Date(t).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" }); }

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
  $$(".tabs button").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.page === page)));
  $$(".page").forEach((panel) => panel.classList.toggle("active", panel.dataset.pagePanel === page));
  if (page === "chart") renderChart();
  if (page === "backtest") renderBacktest();
  if (page === "trade") renderTrade();
  if (page === "risk") renderRisk();
}

function populateSelect(selector, items, selected) {
  const select = $(selector);
  if (!select) return;
  select.innerHTML = items.map((item) => `<option value="${item.code}">${symbolLabel(item.code)}</option>`).join("");
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
  const totalPnl = account.equity - account.initialCash;
  $("#kpi-equity").textContent = money(account.equity, ccy);
  $("#kpi-equity-sub").textContent = `初始 ${money(account.initialCash, ccy)}`;
  $("#kpi-day").textContent = money(totalPnl, ccy);
  $("#kpi-day").className = `kpi ${tone(totalPnl)}`;
  $("#kpi-day-sub").textContent = "紙上帳本累計損益（非即時日損益）";
  $("#kpi-exposure").textContent = money(account.marketValue, ccy);
  $("#kpi-exposure-sub").textContent = `${Object.keys(account.positions).length} 檔持倉・不含未接即時行情`;
  const quotes = marketSymbols().map((item) => quote(item.code));
  const signals = quotes.filter((item) => Math.abs(item.pct) >= 2).length;
  $("#kpi-signal").textContent = `${signals} 個異動`;

  $("#heatmap").innerHTML = quotes.map((item) => {
    const meta = getSymbol(item.code);
    const hot = Math.abs(item.pct) >= 2 ? "hot" : "";
    const changeClass = item.pct > 0.05 ? "up" : item.pct < -0.05 ? "down" : "flat";
    const grow = Math.max(1, Math.sqrt(meta.cap) / 20);
    return `<div class="tile ${changeClass} ${hot}" style="flex-grow:${grow}" data-open-symbol="${item.code}" title="${meta.name}"><div class="t-code">${item.code}</div><div class="t-chg">${pct(item.pct)}</div></div>`;
  }).join("");
  $$("[data-open-symbol]").forEach((tile) => tile.addEventListener("click", () => openSymbol(tile.dataset.openSymbol)));

  $("#dashboard-watchlist tbody").innerHTML = quotes.map((item) => `<tr data-open-symbol="${item.code}"><td><button class="fav" type="button" aria-label="加入自選">★</button> <b>${item.code}</b> <span style="color:var(--muted)">${getSymbol(item.code).name}</span></td><td class="n">${fmtPrice(item.price, ccy)}</td><td class="n ${tone(item.pct)}">${pct(item.pct)}</td><td class="n">${volumeRatio(item.code).toFixed(2)}×</td></tr>`).join("");
  $$("#dashboard-watchlist [data-open-symbol]").forEach((row) => row.addEventListener("click", () => openSymbol(row.dataset.openSymbol)));

  const up = quotes.filter((item) => item.pct > 0).length;
  const down = quotes.filter((item) => item.pct < 0).length;
  const flat = quotes.length - up - down;
  $("#breadth").innerHTML = [
    ["上漲", up, "up"], ["下跌", down, "down"], ["持平", flat, "neutral"],
  ].map(([label, value, cls]) => `<div><span style="color:var(--muted);font-size:12px">${label}</span><div class="kpi ${cls}">${value}</div></div>`).join("");
  renderAudit("#dashboard-audit");
}

function openSymbol(code) {
  state.symbol = code;
  const meta = getSymbol(code);
  state.market = meta.market;
  $$("[data-market]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.market === state.market)));
  populateSymbolSelects();
  auditEvent("SYMBOL_SELECTED", { symbol: code });
  setPage("chart");
}

function renderChart() {
  const meta = getSymbol(state.symbol);
  const q = currentQuote();
  const bars = getBars(state.symbol);
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

function avgLast(values, length) { return values.slice(-length).reduce((a, b) => a + b, 0) / Math.min(length, values.length); }

function renderScreener() {
  const minChange = Number($("#filter-change").value ?? -99);
  const maxPe = Number($("#filter-pe").value ?? 999);
  const minVolume = Number($("#filter-volume").value ?? 0);
  const rows = marketSymbols().map((meta) => ({ meta, quote: quote(meta.code), volume: volumeRatio(meta.code) })).filter((row) => row.quote.pct >= minChange && row.meta.pe <= maxPe && row.volume >= minVolume);
  $("#screen-count").textContent = `${rows.length} / ${marketSymbols().length} 個標的符合`;
  $("#screener-table tbody").innerHTML = rows.map(({ meta, quote: q, volume }) => `<tr data-open-symbol="${meta.code}"><td><button class="fav" type="button" aria-label="加入自選">☆</button></td><td><b>${meta.code}</b> <span style="color:var(--muted)">${meta.name}</span></td><td><span class="badge neutral">${meta.market}</span></td><td class="n">${fmtPrice(q.price, meta.ccy)}</td><td class="n ${tone(q.pct)}">${pct(q.pct)}</td><td class="n">${volume.toFixed(2)}×</td><td class="n">${meta.pe.toFixed(1)}×</td><td class="n">${meta.yield.toFixed(1)}%</td><td><span class="badge ${q.pct > 2 ? "up" : q.pct < -2 ? "down" : "neutral"}">${q.pct > 2 ? "動能" : q.pct < -2 ? "觀察風險" : "中性"}</span></td></tr>`).join("");
  $$("#screener-table [data-open-symbol]").forEach((row) => row.addEventListener("click", () => openSymbol(row.dataset.openSymbol)));
}

function renderBacktest() {
  const select = $("#backtest-symbol");
  if (select) state.symbol = select.value || state.symbol;
  const strategy = $("#backtest-strategy").value;
  const options = {
    initialCapital: Number($("#backtest-capital").value) || 1_000_000,
    fast: Number($("#backtest-fast").value) || 20,
    slow: Number($("#backtest-slow").value) || 50,
    commissionRate: (Number($("#backtest-commission").value) || 0) / 100,
    slippageBps: Number($("#backtest-slippage").value) || 0,
  };
  let result;
  try { result = runBacktest(getBars(state.symbol), strategy, options); }
  catch (error) { $("#backtest-assumptions").textContent = error.message; return; }
  const m = result.metrics;
  $("#backtest-metrics").innerHTML = [
    ["淨損益", money(m.netProfit, getSymbol(state.symbol).ccy), tone(m.netProfit)],
    ["最大回撤", `${m.maxDrawdownPct.toFixed(2)}%`, "down"],
    ["勝率／交易數", `${m.winRate.toFixed(1)}% / ${m.tradeCount}`, "neutral"],
    ["Sharpe", formatMetric(m.sharpe), m.sharpe >= 1 ? "up" : "neutral"],
  ].map(([label, value, cls]) => `<article class="card"><h2>${label}</h2><div class="kpi ${cls}">${value}</div></article>`).join("");
  drawLine($("#equity-chart"), result.equity, { color: "#855bfb", baseline: options.initialCapital });
  $("#backtest-assumptions").innerHTML = `<div class="row"><span>策略</span><span>${STRATEGIES[strategy] ?? strategy}</span></div><div class="row"><span>成交</span><span>下一根 K 開盤</span></div><div class="row"><span>手續費</span><span>${(options.commissionRate * 100).toFixed(4)}%</span></div><div class="row"><span>滑價</span><span>${options.slippageBps} bp</span></div><div class="row"><span>資料</span><span>固定 250 根模擬日 K</span></div>`;
  $("#backtest-trades tbody").innerHTML = result.trades.length ? result.trades.map((trade) => `<tr><td>${fmtDay(trade.entryTime)}</td><td>${fmtDay(trade.exitTime)}</td><td class="n">${trade.qty}</td><td class="n">${fmtPrice(trade.entryPrice)}</td><td class="n">${fmtPrice(trade.exitPrice)}</td><td class="n ${tone(trade.netPnl)}">${signed(trade.netPnl)}</td><td><span class="badge neutral">${trade.exitReason === "end" ? "資料結束" : "訊號"}</span></td></tr>`).join("") : `<tr><td colspan="7" style="color:var(--muted)">此參數組合沒有完成交易；不要把零交易誤當成低風險。</td></tr>`;
}

function renderTrade() {
  const market = $("#trade-market").value || state.market;
  if (market !== state.market) state.market = market;
  const account = broker.snapshot(market, quoteMap(market));
  const meta = getSymbol($("#order-symbol").value || state.symbol);
  $("#account-summary").innerHTML = `<div class="row"><span>帳戶模式</span><span class="badge brand">PAPER</span></div><div class="row"><span>可用現金</span><span>${money(account.cash, account.currency)}</span></div><div class="row"><span>持倉市值</span><span>${money(account.marketValue, account.currency)}</span></div><div class="row"><span>權益</span><span>${money(account.equity, account.currency)}</span></div>`;
  $("#positions-table tbody").innerHTML = Object.values(account.positions).length ? Object.values(account.positions).map((position) => `<tr><td><b>${position.symbol}</b></td><td class="n">${position.qty}</td><td class="n">${fmtPrice(position.avgCost)}</td><td class="n">${fmtPrice(position.last)}</td><td class="n ${tone(position.unrealized)}">${signed(position.unrealized)}</td></tr>`).join("") : `<tr><td colspan="5" style="color:var(--muted)">尚無持倉。紙上帳戶從零開始，不會自動載入券商資料。</td></tr>`;
  $("#orders-table tbody").innerHTML = account.orders.length ? account.orders.map((order) => `<tr><td>${order.timestamp}</td><td>${order.symbol}</td><td class="${order.side === "buy" ? "up" : "down"}">${order.side === "buy" ? "買進" : "賣出"}</td><td class="n">${order.qty}</td><td class="n">${fmtPrice(order.price)}</td><td><span class="badge up">已成交・PAPER</span></td></tr>`).join("") : `<tr><td colspan="6" style="color:var(--muted)">尚無訂單。</td></tr>`;
  updateOrderPrice();
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
  const candidate = { market, symbol, side, qty, price };
  let decision;
  if (!permissionsFor(state.role).includes("paper:order")) decision = { ok: false, code: "ROLE_DENIED", reason: "目前角色是觀察者；切換 Trader 才能建立紙上訂單" };
  else decision = risk.approveOrder(account, candidate);
  const box = $("#order-risk");
  box.className = `notice ${decision.ok ? "info" : ""}`;
  box.textContent = `${decision.ok ? "通過" : "拒絕"}［${decision.code}］${decision.reason}`;
  $("#order-submit").disabled = !decision.ok;
  state.pendingOrder = decision.ok ? candidate : null;
  if (decision.ok) openOrderModal(candidate, account);
  auditEvent(decision.ok ? "ORDER_PREVIEW_APPROVED" : "ORDER_PREVIEW_REJECTED", { symbol, side, qty, price, code: decision.code });
}

function openOrderModal(order, account) {
  $("#order-modal-body").innerHTML = `<div class="notice info">這是紙上帳本寫入，不會送往交易所。</div><div class="row"><span>市場／標的</span><span>${order.market}・${symbolLabel(order.symbol)}</span></div><div class="row"><span>方向／數量</span><span>${order.side === "buy" ? "買進" : "賣出"}・${order.qty}</span></div><div class="row"><span>模擬價格</span><span>${fmtPrice(order.price)}・名目 ${fmtPrice(order.price * order.qty)}</span></div><div class="row"><span>下單後現金</span><span>${money(account.cash - (order.side === "buy" ? order.price * order.qty : -order.price * order.qty), account.currency)}</span></div>`;
  $("#order-modal").classList.add("open");
}

function confirmOrder() {
  if (!state.pendingOrder) return;
  try {
    const order = broker.placeOrder({ ...state.pendingOrder, clientId: state.role });
    auditEvent("ORDER_FILLED_PAPER", { orderId: order.id, symbol: order.symbol, side: order.side, qty: order.qty, price: order.price });
    closeOrderModal();
    state.pendingOrder = null;
    $("#order-risk").className = "notice info";
    $("#order-risk").textContent = `已寫入紙上帳本［${order.id}］；沒有真實券商副作用。`;
    $("#order-submit").disabled = true;
    renderAll();
  } catch (error) {
    closeOrderModal();
    state.pendingOrder = null;
    $("#order-risk").textContent = `寫入拒絕：${error.message}`;
    auditEvent("ORDER_REJECTED_PAPER", { reason: error.message });
  }
}
function closeOrderModal() { $("#order-modal").classList.remove("open"); }

function renderRisk(target = "#audit-log") {
  const status = risk.status();
  $("#risk-state").textContent = status.tripped ? "已凍結" : "運作中";
  $("#risk-state").className = `kpi ${status.tripped ? "down" : "up"}`;
  $("#risk-reason").textContent = status.reason || "所有紙上訂單仍需先經風控";
  const canManage = permissionsFor(state.role).includes("risk:trip");
  $("#kill-switch").disabled = !canManage || status.tripped;
  $("#reset-risk").disabled = !permissionsFor(state.role).includes("risk:reset") || !status.tripped;
  $("#permission-table").innerHTML = Object.entries(ROLE_PERMISSIONS).map(([role, permissions]) => `<div class="row"><span>${role}</span><span class="mono" style="font-size:11px">${permissions.join(" · ")}</span></div>`).join("");
  renderAudit(target);
}

function renderAudit(target = "#audit-log") {
  const element = $(target);
  if (!element) return;
  const entries = audit.list().slice(-40).reverse();
  element.innerHTML = entries.length ? entries.map((entry) => `<div><span class="t">${entry.timestamp}</span><b>${entry.event}</b> <span style="color:var(--muted)">${JSON.stringify(entry.details)}</span></div>`).join("") : `<div style="color:var(--muted)">尚無事件。</div>`;
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
  $$(".tabs button").forEach((button) => button.addEventListener("click", () => setPage(button.dataset.page)));
  $("#role-select").addEventListener("change", (event) => { state.role = event.target.value; auditEvent("ROLE_CHANGED", { role: state.role }); renderAll(); });
  $("#chart-symbol").addEventListener("change", (event) => { state.symbol = event.target.value; renderChart(); });
  $("#chart-window").addEventListener("change", (event) => { state.chartWindow = Number(event.target.value); renderChart(); });
  $("#screen-run").addEventListener("click", renderScreener);
  $("#screen-reset").addEventListener("click", () => { $("#filter-change").value = -99; $("#filter-pe").value = 999; $("#filter-volume").value = 0; renderScreener(); });
  $("#backtest-symbol").addEventListener("change", (event) => { state.symbol = event.target.value; renderBacktest(); });
  $("#backtest-run").addEventListener("click", () => { auditEvent("BACKTEST_RUN", { symbol: state.symbol, strategy: $("#backtest-strategy").value }); renderBacktest(); });
  $("#trade-market").addEventListener("change", (event) => { setMarket(event.target.value); $("#trade-market").value = event.target.value; });
  $("#order-symbol").addEventListener("change", updateOrderPrice);
  $("#order-qty").addEventListener("input", () => { $("#order-submit").disabled = true; });
  $("#order-preview").addEventListener("click", previewOrder);
  $("#order-form").addEventListener("submit", (event) => { event.preventDefault(); if (!state.pendingOrder) previewOrder(event); });
  $("#order-confirm").addEventListener("click", confirmOrder);
  $("#order-cancel").addEventListener("click", () => { state.pendingOrder = null; closeOrderModal(); });
  $("#kill-switch").addEventListener("click", () => { if (!permissionsFor(state.role).includes("risk:trip")) return; risk.trip("使用者手動啟動"); auditEvent("KILL_SWITCH_TRIPPED", {}); renderRisk(); });
  $("#reset-risk").addEventListener("click", () => { if (!permissionsFor(state.role).includes("risk:reset")) return; risk.reset(); auditEvent("KILL_SWITCH_RESET", {}); renderRisk(); });
  $("#export-audit").addEventListener("click", downloadAudit);
  $("#order-modal").addEventListener("click", (event) => { if (event.target.id === "order-modal") closeOrderModal(); });
  window.addEventListener("resize", () => { if (state.page === "chart") renderChart(); if (state.page === "backtest") renderBacktest(); });
}

auditEvent("SESSION_OPEN", { app: "Stock Lab" });
initEvents();
renderAll();
