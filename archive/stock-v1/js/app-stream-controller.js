/* Live stream UI/controller.
   Keeps EventSource lifecycle, actionable errors and targeted DOM updates out of app.js.
   Hard boundary: this module never touches PaperBroker, order-service or RiskEngine. */
"use strict";

import { fmtPrice } from "./data.js";
import { MARKET_DATA_PROXY_URL } from "./proxy-config.js";
import { SseStreamClient } from "./sse-stream-client.js";
import { statePanel } from "./view.js";

const $ = (selector) => document.querySelector(selector);

export const STREAM_ERROR_TEXT = Object.freeze({
  STREAM_AUTH_FAILED: "上游認證失敗，不自動重連；請部署者檢查 server 金鑰",
  STREAM_SUBSCRIBE_FAILED: "訂閱失敗，不自動重連；請檢查標的後手動重試",
  STREAM_RATE_LIMITED: "觸發限流，不自動重連；稍後手動重試",
  STREAM_SCHEMA_INVALID: "串流資料結構異常，已停止",
  STREAM_RECONNECT_EXHAUSTED: "上游重連用盡，已停止；請手動重試",
  STREAM_UPSTREAM_CLOSED: "上游斷線，瀏覽器自動重連中",
  STREAM_TIMEOUT: "逾時，瀏覽器自動重連中",
  INVALID_SYMBOL: "商品代碼不正確，請修正標的",
  RATE_LIMITED: "請求過於頻繁（proxy 限流），不自動重連；請稍候再按「開始串流」",
  FUGLE_MODE_OFF: "目前是模擬模式",
  PROXY_NOT_CONFIGURED: "Fugle mode unavailable：尚未設定 proxy URL",
  UNSUPPORTED_CAPABILITY: "目前瀏覽器不支援 EventSource，不偽裝連線",
});

export const STREAM_ERROR_ACTION = Object.freeze({
  STREAM_SUBSCRIBE_FAILED: "請確認代號是否為有效的 Fugle 商品（例：2330、0050），或改用其他標的後按「開始串流」重試。",
  STREAM_RATE_LIMITED: "本機連線數已達上限，請先按「停止」關閉其他分頁的串流，再按「開始串流」重試。",
  RATE_LIMITED: "請等待約一分鐘再重試；若持續發生，代表同一來源請求過於頻繁。",
  STREAM_AUTH_FAILED: "這是部署端問題：金鑰或 Fugle 方案不足，請通知維護者後再試。",
  STREAM_RECONNECT_EXHAUSTED: "上游連續失敗，請稍候按「開始串流」重試。",
  STREAM_SCHEMA_INVALID: "上游資料格式異常，請通知維護者（不要在此重試轟擊上游）。",
  INVALID_SYMBOL: "請修正上方標的欄位後重試。",
});

export function fmtTaipeiStreamTime(ts) {
  if (!Number.isFinite(ts)) return "未知";
  return new Date(ts).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function describeStreamText(snap) {
  if (!snap || !snap.symbol) return "尚未啟動；切換「Fugle 真實行情」後可開始（瀏覽器經 proxy 收 SSE，不直連上游、不持金鑰）。";
  const staleMark = snap.eventCount === 0 ? "尚無逐筆" : (snap.marketStale ? "STALE" : "FRESH");
  const base = `傳輸 ${snap.transport}・上游 ${snap.upstream ?? "未知"}・${snap.symbol}・新鮮度 ${staleMark}・來源 FUGLE trades（經 proxy）・執行 PAPER`;
  if (snap.error) {
    const hint = STREAM_ERROR_TEXT[snap.error.code] ?? "未知錯誤";
    return `${base}・錯誤 ${snap.error.code}：${hint}${snap.error.terminal ? "（已停止，需手動重試）" : "（自動重連中）"}`;
  }
  return base;
}

export function createStreamController({ getDataMode, auditEvent } = {}) {
  if (typeof getDataMode !== "function") throw new TypeError("getDataMode 必須是函式");
  if (typeof auditEvent !== "function") throw new TypeError("auditEvent 必須是函式");

  let streamClient = null;
  let streamLastStatusText = "";

  function paintStreamCount(snap) {
    const counter = $("#stream-count");
    if (counter) counter.textContent = `逐筆 ${snap?.eventCount ?? 0}`;
  }

  function paintStreamLatest(trade) {
    const latest = $("#stream-latest");
    if (!latest || !streamClient || !trade) return;
    const snap = streamClient.getSnapshot();
    const price = Number.isFinite(trade?.trade?.price) ? fmtPrice(trade.trade.price) : "N/A";
    const fresh = snap.marketStale ? "STALE" : (trade.freshnessStatus ?? "UNKNOWN");
    latest.textContent = `${trade.symbol} 最新 ${price}・${fmtTaipeiStreamTime(trade.providerTimestamp)}・${fresh}・seq ${trade.sequence ?? "?"}`;
  }

  function renderStreamAlert(snap) {
    const box = $("#stream-alert");
    if (!box) return;
    const error = snap?.error;
    if (!error) {
      box.innerHTML = "";
      return;
    }
    const hint = STREAM_ERROR_TEXT[error.code] ?? "未知錯誤";
    const action = STREAM_ERROR_ACTION[error.code] ?? "請按「開始串流」手動重試；若持續發生，請通知維護者。";
    box.innerHTML = statePanel("error", `串流中止［${error.code}］${error.terminal ? "（需手動重試）" : "（自動重連中）"}`, `${hint}。${action}`);
  }

  function update() {
    const startBtn = $("#stream-start");
    const stopBtn = $("#stream-stop");
    const badge = $("#stream-state-badge");
    const status = $("#stream-status");
    if (!startBtn || !stopBtn || !badge || !status) return;
    const snap = streamClient ? streamClient.getSnapshot() : null;
    const active = !!snap && ["OPEN", "CONNECTING", "RECONNECTING"].includes(snap.transport);
    startBtn.disabled = active;
    stopBtn.disabled = !active;
    const toneName = !snap || !snap.symbol ? "neutral" : snap.transport === "FAILED" ? "down" : snap.upstream === "LIVE" ? "up" : "neutral";
    badge.className = `badge ${toneName}`;
    badge.textContent = snap?.upstream ?? snap?.transport ?? "IDLE";
    const text = describeStreamText(snap);
    if (text !== streamLastStatusText) {
      status.textContent = text;
      streamLastStatusText = text;
    }
    renderStreamAlert(snap);
    paintStreamCount(snap);
    const trades = streamClient ? streamClient.recentTrades() : [];
    if (trades.length) paintStreamLatest(trades[trades.length - 1]);
  }

  function renderTrade(trade) {
    paintStreamLatest(trade);
    if (streamClient) paintStreamCount(streamClient.getSnapshot());
    const box = $("#stream-trades");
    if (!box || !trade) return;
    box.querySelector(".state-block")?.remove();
    const row = document.createElement("div");
    const price = Number.isFinite(trade?.trade?.price) ? fmtPrice(trade.trade.price) : "N/A";
    const size = Number.isFinite(trade?.trade?.size) ? trade.trade.size : "?";
    row.textContent = `${fmtTaipeiStreamTime(trade.providerTimestamp)} ${trade.symbol} ${price} x${size}・${trade.freshnessStatus ?? "UNKNOWN"}`;
    box.prepend(row);
    while (box.children.length > 10) box.lastChild.remove();
  }

  function renderError(detail) {
    update();
    auditEvent("STREAM_ERROR", { symbol: detail?.symbol ?? null, code: detail?.code ?? "UNKNOWN" });
  }

  function ensureClient() {
    if (streamClient) return streamClient;
    streamClient = new SseStreamClient({ baseUrl: MARKET_DATA_PROXY_URL });
    streamClient.on("transport", update);
    streamClient.on("upstream", update);
    streamClient.on("trade", renderTrade);
    streamClient.on("error", renderError);
    return streamClient;
  }

  function start() {
    const input = $("#stream-symbol");
    const fallback = $("#fugle-symbol");
    const want = (input?.value.trim() || fallback?.value.trim() || "2330").toUpperCase();
    try {
      if (getDataMode() !== "fugle-proxy") throw Object.assign(new Error("切換「Fugle 真實行情」後再開始串流"), { code: "FUGLE_MODE_OFF" });
      if (!MARKET_DATA_PROXY_URL) throw Object.assign(new Error("部署時注入 proxy URL 後可用"), { code: "PROXY_NOT_CONFIGURED" });
      if (typeof EventSource === "undefined") throw Object.assign(new Error("目前瀏覽器不支援串流"), { code: "UNSUPPORTED_CAPABILITY" });
      const client = ensureClient();
      const snap = client.getSnapshot();
      const busy = ["OPEN", "CONNECTING", "RECONNECTING"].includes(snap.transport);
      if (busy && snap.symbol === want) return;
      client.start(want);
      const opened = client.getSnapshot();
      if (input) input.value = opened.symbol ?? want;
      auditEvent("STREAM_STARTED", { symbol: opened.symbol });
      $("#stream-stop")?.focus();
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "UNKNOWN";
      streamLastStatusText = "";
      const status = $("#stream-status");
      if (status) status.textContent = `串流啟動失敗［${code}］：${STREAM_ERROR_TEXT[code] ?? "未知錯誤"}維持 Fugle 模式，不切回模擬。`;
      renderStreamAlert({ error: { code, terminal: true } });
      auditEvent("STREAM_ERROR", { symbol: want, code });
    }
    update();
  }

  function stop({ reason = null, onlyIfCreated = false } = {}) {
    if (!streamClient && onlyIfCreated) {
      update();
      return false;
    }
    streamClient?.stop();
    auditEvent("STREAM_STOPPED", reason ? { reason } : {});
    update();
    return true;
  }

  return Object.freeze({
    start,
    stop,
    update,
    stopForModeChange: () => stop({ reason: "DATA_MODE_CHANGED", onlyIfCreated: true }),
  });
}
