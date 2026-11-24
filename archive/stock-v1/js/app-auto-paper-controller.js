/* Browser orchestration for Automated Paper Trading v1.
   The controller fetches normalized Fugle data and delegates all decisions/mutations
   to AutoPaperRunner. It never talks to a live broker and never owns strategy math. */
"use strict";

import { AUTO_PAPER_ALLOCATION } from "./auto-paper-promotion.js";
import { AutoPaperRunner } from "./auto-paper-runner.js";
import { fugleResearchRange } from "./research-range.js";

export { AUTO_PAPER_ALLOCATION };
const AUTO_CYCLE_MS = 5 * 60_000;
const $ = (selector) => document.querySelector(selector);

function taipeiYMD(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function resultText(result) {
  const fills = Array.isArray(result?.fills) ? result.fills : [];
  if (result?.code === "EXECUTED") {
    return `已執行 ${fills.length} 筆 Paper fill：${fills.map((f) => `${f.side} ${f.filledQty ?? f.qty}@${f.fillPrice ?? f.price}`).join("、")}`;
  }
  const map = {
    AUTO_NOT_ENABLED: "尚未武裝，自動交易不會執行。",
    INSUFFICIENT_COMPLETED_BARS: "完成日 K 不足策略 warmup，維持等待。",
    NO_TARGET_CHANGE: "本根完成 K 棒沒有目標部位變化。",
    WAIT_NEXT_SESSION: "訊號已排隊，等待下一個交易時段。",
    ORDER_WORKING: "DAY 限價單已掛入 Paper Matching Engine，等待 fresh quote 觸價。",
    ORDER_EXPIRED: "DAY 掛單未成交並已過期，不會沿用舊訊號重掛。",
    ORDER_CANCELED: "掛單已取消；需等新的完成 K 棒訊號。",
    STALE_QUOTE: "報價不新鮮，拒絕執行；pending intent 保留。",
    TARGET_ALREADY_MET: "目前持倉已符合策略目標，不需下單。",
    KILL_SWITCH: "Risk kill switch 已啟動，自動交易停止。",
    INVALID_QUOTE: "報價格式無效，拒絕執行。",
    RECONCILIATION_FAILED: "成交後對帳異常，已觸發 kill switch。",
  };
  return map[result?.code] ?? `本輪結果：${result?.code ?? "UNKNOWN"}`;
}

export function createAutoPaperController({
  strategy,
  allocate,
  broker,
  risk,
  storage,
  getFugleAdapter,
  getDataMode,
  canTrade,
  auditEvent,
  onAccountChanged = () => {},
  clock = () => Date.now(),
  cycleMs = AUTO_CYCLE_MS,
} = {}) {
  if (!strategy || typeof strategy.generateSignal !== "function") throw new Error("auto controller 需要 strategy");
  if (typeof allocate !== "function") throw new Error("auto controller 需要 allocator");
  if (typeof getFugleAdapter !== "function" || typeof getDataMode !== "function") throw new Error("auto controller 需要 market-data boundary");
  if (typeof canTrade !== "function") throw new Error("auto controller 需要 permission boundary");

  const runners = new Map();
  let timer = null;
  let running = false;

  function symbolValue() {
    return ($("#auto-paper-symbol")?.value || $("#fugle-symbol")?.value || "2330").trim().toUpperCase();
  }

  function runnerFor(symbol = symbolValue()) {
    if (!runners.has(symbol)) {
      runners.set(symbol, new AutoPaperRunner({
        strategy,
        allocate,
        broker,
        risk,
        storage,
        market: "TW",
        symbol,
        clock,
        canTrade,
        auditEvent,
      }));
    }
    return runners.get(symbol);
  }

  function renderStatus(message = "") {
    const symbol = symbolValue();
    const status = runnerFor(symbol).status();
    const badge = $("#auto-paper-state");
    const detail = $("#auto-paper-status");
    const arm = $("#auto-paper-arm");
    const pause = $("#auto-paper-pause");
    const run = $("#auto-paper-run");

    if (badge) {
      badge.textContent = status.lifecycle;
      badge.className = `badge ${status.lifecycle === "PAPER_ENABLED" ? "up" : status.lifecycle === "KILL_SWITCHED" ? "down" : "neutral"}`;
    }
    if (detail) {
      const approval = status.approval?.pass ? "Gate PASS" : "Gate 尚未 PASS";
      const pending = status.pendingIntent
        ? `・pending target=${status.pendingIntent.targetBinary} bar=${new Date(status.pendingIntent.signalBarTimestamp).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}`
        : "";
      detail.textContent = `${symbol}・${strategy.name}・${approval}・last=${status.lastOutcome}${pending}${message ? `・${message}` : ""}`;
    }
    if (arm) arm.disabled = !status.approval?.pass || status.lifecycle === "PAPER_ENABLED" || !canTrade();
    if (pause) pause.disabled = status.lifecycle !== "PAPER_ENABLED";
    if (run) run.disabled = status.lifecycle !== "PAPER_ENABLED" || running;
    return status;
  }

  function stopLoop() {
    if (timer !== null) clearInterval(timer);
    timer = null;
  }

  function startLoop() {
    stopLoop();
    timer = setInterval(() => {
      cycleOnce().catch(() => {});
    }, cycleMs);
    timer.unref?.();
  }

  async function cycleOnce() {
    if (running) return { ok: false, code: "CYCLE_ALREADY_RUNNING" };
    running = true;
    renderStatus("執行中");
    try {
      if (getDataMode() !== "fugle-proxy") {
        const result = { ok: false, code: "FUGLE_MODE_REQUIRED" };
        renderStatus("請切換 Fugle 真實行情");
        return result;
      }
      const symbol = symbolValue();
      const adapter = getFugleAdapter();
      const to = taipeiYMD(new Date(clock()));
      const { from } = fugleResearchRange({ to });
      const [barsResult, quoteEnvelope] = await Promise.all([
        adapter.getBarsAsync(symbol, { from, to }),
        adapter.quoteAsync(symbol),
      ]);
      const envelope = barsResult?.envelope;
      if (envelope?.meta?.provider !== "FUGLE" || quoteEnvelope?.meta?.provider !== "FUGLE") {
        throw Object.assign(new Error("provenance 非 FUGLE，拒絕自動交易"), { code: "DATA_INVALID" });
      }
      const result = await runnerFor(symbol).cycle({
        bars: envelope.data,
        quoteEnvelope,
        now: clock(),
      });
      renderStatus(resultText(result));
      if (result.code === "EXECUTED") onAccountChanged();
      return result;
    } catch (error) {
      renderStatus(`錯誤[${error?.code ?? "UNKNOWN"}] ${error?.message ?? "unknown"}`);
      auditEvent("AUTO_CYCLE_ERROR", { symbol: symbolValue(), code: error?.code ?? "UNKNOWN", message: error?.message ?? "unknown" });
      return { ok: false, code: error?.code ?? "UNKNOWN", error };
    } finally {
      running = false;
      renderStatus();
    }
  }

  function recordResearchGate({ symbol, pass, evidence }) {
    const clean = String(symbol || symbolValue()).trim().toUpperCase();
    const status = runnerFor(clean).recordResearchGate({ pass, evidence });
    if ($("#auto-paper-symbol")) $("#auto-paper-symbol").value = clean;
    if (status.lifecycle !== "PAPER_ENABLED") stopLoop();
    renderStatus(pass ? "研究 Gate PASS，可武裝" : "研究 Gate FAIL，保持停用");
    return status;
  }

  function arm() {
    const status = runnerFor().arm();
    startLoop();
    renderStatus("已武裝；頁面開啟期間每 5 分鐘自動跑一輪");
    cycleOnce().catch(() => {});
    return status;
  }

  function pause() {
    const status = runnerFor().pause("user");
    stopLoop();
    renderStatus("已暫停");
    return status;
  }

  function bind() {
    $("#auto-paper-arm")?.addEventListener("click", () => {
      try { arm(); } catch (error) { renderStatus(error.message); }
    });
    $("#auto-paper-pause")?.addEventListener("click", pause);
    $("#auto-paper-run")?.addEventListener("click", () => cycleOnce());
    $("#auto-paper-symbol")?.addEventListener("change", () => {
      stopLoop();
      const status = renderStatus("標的已切換");
      if (status.lifecycle === "PAPER_ENABLED") startLoop();
    });
    const status = renderStatus();
    if (status.lifecycle === "PAPER_ENABLED") startLoop();
  }

  function notifyDataModeChanged() {
    const status = renderStatus();
    if (status.lifecycle === "PAPER_ENABLED" && getDataMode() === "fugle-proxy") cycleOnce().catch(() => {});
  }

  bind();

  return Object.freeze({
    arm,
    pause,
    cycleOnce,
    recordResearchGate,
    refresh: renderStatus,
    notifyDataModeChanged,
    status: () => runnerFor().status(),
  });
}

export { AUTO_CYCLE_MS };
