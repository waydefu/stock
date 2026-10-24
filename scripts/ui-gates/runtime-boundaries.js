/* Runtime/security UI gates extracted from check-ui.js.
   Pure result contract: no process.exit and no console output, so rules are unit-testable. */
"use strict";

import { readFileSync } from "node:fs";

function result(id, problems) {
  return { id, problems };
}

export function checkRuntimeBoundaries({ app = "", html = "", readFile = readFileSync } = {}) {
  const read = (path) => readFile(path, "utf8");
  const results = [];

  {
    const problems = [];
    const proxy = read("server/market-proxy.js");
    const manager = read("server/fugle-stream-manager.js");
    const streamUi = read("js/app-stream-controller.js");
    const browserStream = `${app}\n${streamUi}`;
    if (!/\/api\/market\/stream/.test(proxy)) problems.push("proxy 缺 SSE route");
    if (!/text\/event-stream/.test(read("server/stream-sse.js"))) problems.push("SSE 缺正確 content-type");
    if (!/normalizeFugleTrade/.test(manager)) problems.push("bridge 未經 normalization 就轉發（禁 raw forward）");
    if (/new WebSocket\(/.test(browserStream)) problems.push("browser 端出現 new WebSocket（禁止直連 upstream）");
    if (/FUGLE_API_KEY|apikey/.test(browserStream)) problems.push("browser bundle 出現 key 字樣");

    const sseClient = read("js/sse-stream-client.js");
    if (!/class SseStreamClient/.test(sseClient)) problems.push("缺 provider-neutral browser stream client");
    if (/PaperBroker|order-service|executePaperOrder|paper\.js|risk\.js|fugle-mapper/.test(sseClient)) problems.push("stream client 接觸下單／風控／mapper（PAPER 隔離破裂）");
    if (/new WebSocket\(|fetch\s*\(|https?:\/\//.test(sseClient)) problems.push("stream client 出現禁用網路形狀（只許經 proxy 的 EventSource）");
    if (!/generation/.test(sseClient)) problems.push("stream client 缺 generation guard（切 symbol 會污染）");

    const forbiddenStreamImports = [
      'from "./paper.js"', "from './paper.js'",
      'from "./risk.js"', "from './risk.js'",
      'from "./order-service.js"', "from './order-service.js'",
      'from "./providers/fugle-mapper.js"', "from './providers/fugle-mapper.js'",
    ];
    if (forbiddenStreamImports.some((marker) => streamUi.includes(marker)) || /executePaperOrder\s*\(/.test(streamUi)) {
      problems.push("stream UI controller 匯入下單／風控／mapper（PAPER 隔離破裂）");
    }
    if (!/STREAM_STARTED/.test(streamUi) || !/#stream-symbol/.test(streamUi)) problems.push("stream UI controller 未接 Live UI 啟動／標的");
    results.push(result("stream-bridge-boundary", problems));
  }

  {
    const problems = [];
    const streamUi = read("js/app-stream-controller.js");
    if (!/id="stream-alert"/.test(html)) problems.push("index.html 缺 stream-alert 容器（可行動錯誤態）");
    if (!/STREAM_SUBSCRIBE_FAILED/.test(streamUi)) problems.push("stream controller 缺 STREAM_SUBSCRIBE_FAILED 文案");
    if (!/STREAM_ERROR_ACTION/.test(streamUi)) problems.push("stream controller 缺可行動錯誤對照表（STREAM_ERROR_ACTION）");
    if (!/RATE_LIMITED/.test(streamUi)) problems.push("stream controller 缺 RATE_LIMITED（proxy 限流）文案");
    if (!/statePanel\("error"/.test(streamUi)) problems.push('stream controller 的串流錯誤未用 statePanel("error") 呈現');
    results.push(result("stream-actionable-errors", problems));
  }

  {
    const problems = [];
    const riskUi = read("js/app-risk-audit-controller.js");
    const forbiddenImports = [
      'from "./paper.js"', "from './paper.js'",
      'from "./order-service.js"', "from './order-service.js'",
    ];
    if (forbiddenImports.some((entry) => riskUi.includes(entry))) problems.push("risk/audit UI controller 匯入 broker／order service");
    if (/approveOrder\s*\(|\.trip\s*\(|\.reset\s*\(|executePaperOrder\s*\(/.test(riskUi)) problems.push("risk/audit UI controller 含風控決策或下單副作用");
    if (!/risk\.status\s*\(/.test(riskUi) || !/audit\.list\s*\(/.test(riskUi)) problems.push("risk/audit UI controller 缺 read-only state 讀取");
    results.push(result("risk-audit-presentation-boundary", problems));
  }

  {
    const problems = [];
    const paperRuntime = read("js/paper-runtime.js");
    const paperFee = read("js/paper-fee-model.js");
    if (!/createAppPaperRuntime/.test(app)) problems.push("app 未使用 createAppPaperRuntime");
    if (/new\s+PaperBroker\s*\(/.test(app)) problems.push("app 直接 new PaperBroker，可能繞過 runtime fee policy");
    if (!/new\s+PaperBroker\s*\(\{[\s\S]*feeModel/.test(paperRuntime)) problems.push("paper runtime 未把 feeModel 注入 PaperBroker");
    if (!/market === "TW"/.test(paperFee) || !/market === "US"/.test(paperFee)) problems.push("paper fee policy 缺 TW／US 明確分流");
    if (!/dayTrade:\s*false/.test(paperFee)) problems.push("TW paper fee policy 未明確禁止猜測當沖減稅");
    if (!/Paper 交易成本/.test(app)) problems.push("交易 UI 未顯示 Paper 交易成本");
    results.push(result("paper-forward-fee-policy", problems));
  }

  {
    const problems = [];
    const autoUi = read("js/app-auto-paper-controller.js");
    const autoRunner = read("js/auto-paper-runner.js");
    const reconciliation = read("js/paper-reconciliation.js");
    const orderService = read("js/order-service.js");
    if (!/id="auto-paper-arm"/.test(html) || !/id="auto-paper-state"/.test(html)) problems.push("缺 Auto Paper 明確武裝／狀態 UI");
    if (/PaperBroker|order-service|risk\.js/.test(autoUi)) problems.push("Auto Paper UI controller 直接耦合 broker／order-service／risk 模組");
    if (/fetch\s*\(|new\s+WebSocket\s*\(/.test(autoRunner)) problems.push("Auto Paper Runner 不得自行連網，資料必須由 adapter 注入");
    if (!/recordResearchGate/.test(autoRunner) || !/RESEARCH_APPROVED/.test(autoRunner) || !/PAPER_ENABLED/.test(autoRunner)) problems.push("Auto Paper Runner 缺 research gate／lifecycle");
    if (!/quoteIsFresh/.test(autoRunner) || !/STALE_QUOTE/.test(autoRunner)) problems.push("Auto Paper Runner 缺 fresh quote fail-closed");
    if (!/canTrade/.test(autoRunner)) problems.push("Auto Paper Runner 缺 paper:order 權限邊界");
    if (!/executePaperOrder/.test(autoRunner) || !/processPaperMatches/.test(autoRunner)) problems.push("Auto Paper Runner 未走 submit＋match 的 Risk→Paper execution boundary");
    if (!/reconcilePaperFill/.test(orderService) || !/RECONCILIATION_FAILED/.test(orderService) || !/risk\.trip/.test(orderService)) problems.push("Matching service 缺成交後 reconciliation／kill switch");
    if (!/assertAccountingInvariants/.test(reconciliation)) problems.push("Paper reconciliation 未檢查 accounting invariant");
    results.push(result("automated-paper-safety-boundary", problems));
  }

  {
    const problems = [];
    const execution = read("js/execution-model.js");
    const paper = read("js/paper.js");
    const orderService = read("js/order-service.js");
    const orderState = read("js/order-state.js");
    if (!/class MatchingExecutionModel/.test(execution) || !/LAST_TRADE_TOUCHED_LIMIT/.test(execution)) problems.push("MATCHING 缺 last-trade touch 模型");
    if (!/full-fill-at-limit\/no-l2-queue/.test(execution)) problems.push("MATCHING 未明示 no-L2／full-fill-at-limit 假設");
    if (!/EXPIRED/.test(orderState) || !/EXPIRE/.test(orderState)) problems.push("訂單生命週期缺 EXPIRED");
    if (!/reservedCash/.test(paper) || !/availableCash/.test(paper) || !/reservedPositions/.test(paper)) problems.push("PaperBroker 缺掛單資金／部位 reservation");
    if (!/fillOpenOrder/.test(paper) || !/cancelOrder/.test(paper) || !/expireOpenOrders/.test(paper)) problems.push("PaperBroker 缺 fill／cancel／expire matching API");
    if (!/processPaperMatches/.test(orderService) || !/risk\.approveOrder/.test(orderService)) problems.push("matching fill 未在成交邊界重跑 RiskEngine");
    if (!/data-cancel-paper-order/.test(app) || !/掛單保留/.test(app)) problems.push("交易 UI 缺 OPEN 單取消或 reservation 可見性");
    results.push(result("paper-matching-boundary", problems));
  }

  return results;
}
