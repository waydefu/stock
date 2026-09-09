/* Stock Lab UI orchestration.
   介面層只組合資料、回測、風控與紙上 broker；沒有網路、秘密或真實下單副作用。 */
"use strict";

import { SYMBOLS, fmtDate, fmtInt, fmtPrice, getBars, getSymbol, quote, rsi, volumeRatio } from "./data.js";
import { drawCandles, drawLine } from "./charts.js";
import { formatMetric, runBacktest, STRATEGIES } from "./backtest.js";
import { MemoryStorage, PaperBroker } from "./paper.js";
import { executePaperOrder } from "./order-service.js";
import { escapeHtml } from "./dom.js";
import { loadFavorites, toggleFavorite } from "./favorites.js";
import { avgLast, fmtDay, money, pct, signed, statePanel, stateRow, symbolLabel, tone } from "./view.js";
import { AuditLog, DEFAULT_RISK, ROLE_PERMISSIONS, RiskEngine, permissionsFor } from "./risk.js";

const state = {
  market: "TW",
  role: "observer",
  symbol: "2330",
  page: "dashboard",
  chartWindow: 90,
  pendingOrder: null,
  modalTrigger: null,
};
let clientOrderSequence = 0;

const storage = typeof localStorage === "undefined" ? new MemoryStorage() : localStorage;
const broker = new PaperBroker({ storage });
const risk = new RiskEngine(DEFAULT_RISK);
const audit = new AuditLog({ storage });
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const nextClientOrderId = () => globalThis.crypto?.randomUUID?.() ?? `ui-${Date.now()}-${++clientOrderSequence}`;

function marketSymbols() { return SYMBOLS.filter((item) => item.market === state.market); }
function currentQuote(code = state.symbol) { return quote(code); }
function quoteMap(market = state.market) {
  return Object.fromEntries(marketSymbolsFor(market).map((item) => [item.code, quote(item.code)]));
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
  const quotes = marketSymbols().map((item) => quote(item.code));
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

function renderScreener() {
  const minChange = Number($("#filter-change").value ?? -99);
  const maxPe = Number($("#filter-pe").value ?? 999);
  const minVolume = Number($("#filter-volume").value ?? 0);
  const rows = marketSymbols().map((meta) => ({ meta, quote: quote(meta.code), volume: volumeRatio(meta.code) })).filter((row) => row.quote.pct >= minChange && row.meta.pe <= maxPe && row.volume >= minVolume);
  $("#screen-count").textContent = `${rows.length} / ${marketSymbols().length} 個標的符合`;
  const favs = loadFavorites(storage);
  const screenerBody = rows.length ? rows.map(({ meta, quote: q, volume }) => `<tr data-open-symbol="${escapeHtml(meta.code)}"><td>${favButton(meta.code, favs)}</td><td><b>${escapeHtml(meta.code)}</b> <span class="muted">${escapeHtml(meta.name)}</span></td><td><span class="badge neutral">${escapeHtml(meta.market)}</span></td><td class="n">${fmtPrice(q.price, meta.ccy)}</td><td class="n ${tone(q.pct)}">${pct(q.pct)}</td><td class="n">${volume.toFixed(2)}×</td><td class="n">${meta.pe.toFixed(1)}×</td><td class="n">${meta.yield.toFixed(1)}%</td><td><span class="badge ${q.pct > 2 ? "up" : q.pct < -2 ? "down" : "neutral"}">${q.pct > 2 ? "動能" : q.pct < -2 ? "觀察風險" : "中性"}</span></td></tr>`).join("") : stateRow(9, "empty", "沒有符合條件的標的", "放寬日變化、本益比或量比條件後再試一次。");
  $("#screener-table tbody").innerHTML = screenerBody;
  $$("#screener-table [data-open-symbol]").forEach((row) => row.addEventListener("click", () => openSymbol(row.dataset.openSymbol)));
  bindFavButtons("#screener-table", renderScreener);
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
    ["勝率／交易數", `${m.winRate.toFixed(1)}% / ${m.tradeCount}`, "neutral"],
    ["Sharpe", m.sharpeInsufficient ? "樣本不足" : formatMetric(m.sharpe), m.sharpeInsufficient ? "neutral" : m.sharpe >= 1 ? "up" : "neutral"],
  ].map(([label, value, cls]) => `<article class="card"><h2>${label}</h2><div class="kpi ${cls}">${value}</div></article>`).join("");
  drawLine($("#equity-chart"), result.equity, { color: "#855bfb", baseline: options.initialCapital });
  $("#backtest-assumptions").innerHTML = `<div class="row"><span>策略</span><span>${escapeHtml(STRATEGIES[strategy] ?? strategy)}</span></div><div class="row"><span>成交</span><span>立即紙上模擬成交</span></div><div class="row"><span>手續費</span><span>${(options.commissionRate * 100).toFixed(4)}%</span></div><div class="row"><span>滑價</span><span>${options.slippageBps} bp</span></div><div class="row"><span>Sharpe</span><span>risk-free ${((result.assumptions.riskFreeRate ?? 0) * 100).toFixed(2)}%・樣本 ${m.sharpeSamples}/${result.assumptions.minSharpeSamples}${m.sharpeInsufficient ? "・不足不採信" : ""}</span></div><div class="row"><span>資料</span><span>固定 250 根模擬日 K</span></div>`;
  $("#backtest-trades tbody").innerHTML = result.trades.length ? result.trades.map((trade) => `<tr><td>${fmtDay(trade.entryTime)}</td><td>${fmtDay(trade.exitTime)}</td><td class="n">${trade.qty}</td><td class="n">${fmtPrice(trade.entryPrice)}</td><td class="n">${fmtPrice(trade.exitPrice)}</td><td class="n ${tone(trade.netPnl)}">${signed(trade.netPnl)}</td><td><span class="badge neutral">${trade.exitReason === "end" ? "資料結束" : "訊號"}</span></td></tr>`).join("") : stateRow(7, "empty", "此參數組合沒有完成交易", "不要把零交易誤當成低風險；調整策略或檢查樣本。");
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
  const candidate = { market, symbol, side, qty, price, lot: market === "TW" ? "oddLot" : "regular", clientOrderId: nextClientOrderId() };
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
  });
  if (!result.filled) {
    closeOrderModal();
    state.pendingOrder = null;
    $("#order-submit").disabled = true;
    $("#order-risk").textContent = `確認時拒絕［${result.decision.code}］${result.decision.reason}`;
    auditEvent("ORDER_CONFIRM_REJECTED", { symbol: pending.symbol, code: result.decision.code, reason: result.decision.reason });
    renderTrade();
    return;
  }
  const order = result.fill;
  auditEvent("ORDER_FILLED_PAPER", { orderId: order.id, symbol: order.symbol, side: order.side, qty: order.qty, price: order.price });
  closeOrderModal();
  state.pendingOrder = null;
  $("#order-risk").className = "notice info";
  $("#order-risk").textContent = `已寫入紙上帳本［${order.id}］；沒有真實券商副作用。`;
  $("#order-submit").disabled = true;
  renderAll();
}
function closeOrderModal() {
  const modal = $("#order-modal");
  modal.classList.remove("open");
  modal.hidden = true;
  if (state.modalTrigger instanceof HTMLElement) state.modalTrigger.focus();
  state.modalTrigger = null;
}

function handleModalKeydown(event) {
  const modal = $("#order-modal");
  if (modal.hidden || !modal.classList.contains("open")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    state.pendingOrder = null;
    closeOrderModal();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...modal.querySelectorAll("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])")];
  if (!focusable.length) return;
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
  $("#order-modal").addEventListener("click", (event) => { if (event.target.id === "order-modal") { state.pendingOrder = null; closeOrderModal(); } });
  $("#order-modal").addEventListener("keydown", handleModalKeydown);
  window.addEventListener("resize", () => { if (state.page === "chart") renderChart(); if (state.page === "backtest") renderBacktest(); });
}

auditEvent("SESSION_OPEN", { app: "Stock Lab" });
initEvents();
setPage(state.page);
renderAll();
