/* Fugle upstream WebSocket manager (Phase 7C PR2b, server-only).
   Trust boundary: THIS process holds FUGLE_API_KEY and speaks the Fugle
   streaming protocol; browsers only ever see provider-neutral SSE envelopes.
   Official spec (re-verified 2026-09-12, docs "Last updated Jan 9, 2026"):
   wss://api.fugle.tw/marketdata/v1.0/stock/streaming, post-connect
   {event:"auth"} -> authenticated / error, {event:"subscribe"} -> subscribed{id},
   {event:"unsubscribe", data:{id|ids}}, 30s {event:"heartbeat"}, data frames
   carry number `time` in MICROSECONDS (official example 1685338200000000)
   and `serial` (流水號). One socket carries many symbol subscriptions, so
   this manager keeps ONE upstream connection with a subscription registry and
   fans out to N SSE sinks per key. No network/timers/ids of its own: socket
   factory, clock, timers and id generator are all injected (deterministic). */
"use strict";

import {
  STREAM_CHANNELS,
  STREAM_ERROR_CODE,
  STREAM_STATES,
  StreamError,
  assertStreamTransition,
  checkSequence,
  classifyUpstreamFrame,
  isStreamStale,
  mapUpstreamError,
  normalizeStreamEvent,
  planReconnect,
  redactForLog,
} from "../js/stream-contract.js";

export const FUGLE_STREAM_URL = "wss://api.fugle.tw/marketdata/v1.0/stock/streaming";
/* Fugle trade `time` unit: microseconds per the official trades example
   (1685338200000000 == 2023-05-29T13:30:00+08:00). Locked by test, not guessed. */
export const FUGLE_TRADE_TIME_DIVISOR = 1000;
export const SUPPORTED_STREAM_CHANNELS = Object.freeze([STREAM_CHANNELS.TRADES]);
/* Watchdog: official heartbeat is 30s; two missed beats + margin => dead. */
export const UPSTREAM_SILENCE_LIMIT_MS = 75_000;

const SYMBOL_PATTERN = /^[A-Za-z0-9]{4,6}$/;

export function streamKey(symbol, channel = STREAM_CHANNELS.TRADES) {
  return `FUGLE:TW:${String(symbol).toUpperCase()}:${channel}`;
}

function fail(code, message, details = null) {
  throw new StreamError(code, message, details);
}

export function assertStreamSymbol(symbol) {
  if (typeof symbol !== "string" || symbol.length > 6 || !SYMBOL_PATTERN.test(symbol)) {
    fail(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, `symbol 格式不正確：${symbol}`);
  }
  return symbol.toUpperCase();
}

export function assertStreamChannel(channel) {
  if (!SUPPORTED_STREAM_CHANNELS.includes(channel)) {
    fail(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, `本版 stream 只支援 ${SUPPORTED_STREAM_CHANNELS.join("/")}（收到 ${channel}）`);
  }
  return channel;
}

/* Upstream trade frame -> normalized envelope. Raw payload never leaves here. */
export function normalizeFugleTrade(frame, { symbol, channel, sessionId, receivedAt, now }) {
  const data = frame?.data;
  if (!data || typeof data !== "object") fail(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, "trade frame 缺 data 物件");
  if (!Number.isFinite(data.time)) fail(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, "trade 缺 number 型 time（微秒）");
  const providerTimestamp = Math.floor(data.time / FUGLE_TRADE_TIME_DIVISOR);
  if (!Number.isFinite(providerTimestamp)) fail(STREAM_ERROR_CODE.STREAM_SCHEMA_INVALID, "trade time 轉換後非有限數");
  return normalizeStreamEvent(
    {
      symbol: data.symbol ?? symbol,
      type: data.type ?? null,
      exchange: data.exchange ?? null,
      market: data.market ?? null,
      bid: Number.isFinite(data.bid) ? data.bid : null,
      ask: Number.isFinite(data.ask) ? data.ask : null,
      price: Number.isFinite(data.price) ? data.price : null,
      size: Number.isFinite(data.size) ? data.size : null,
      volume: Number.isFinite(data.volume) ? data.volume : null,
      serial: data.serial ?? null,
      flags: {
        isLimitUpPrice: data.isLimitUpPrice === true,
        isLimitDownPrice: data.isLimitDownPrice === true,
        isOpen: data.isOpen === true,
        isClose: data.isClose === true,
        isContinuous: data.isContinuous === true,
      },
    },
    {
      provider: "FUGLE", market: "TW", symbol, channel,
      providerTimestamp, receivedAt, source: "FUGLE_STREAM",
      sessionId, isTrial: data.isTrial === true, now,
    },
  );
}

export function createStreamManager({
  apiKey = "",
  url = FUGLE_STREAM_URL,
  webSocketFactory = null,
  clock = () => Date.now(),
  timers = null,
  id = null,
  logger = null,
  maxReconnectAttempts = 5,
  baseDelayMs = 1000,
  maxDelayMs = 30_000,
  staleAfterMs,
  maxSseClients = 50,
  maxSubscriptionKeys = 20,
  maxSseClientsPerClient = 3,
} = {}) {
  const t = timers ?? { setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis) };
  const newId = id ?? (() => `ss-${Math.floor(clock())}-${Math.floor(Math.random() * 1e6)}`);
  const log = (...args) => { try { logger?.(...args); } catch { /* logging never breaks streaming */ } };
  const sessionId = newId();

  const subs = new Map(); // key -> {key, symbol, channel, upstreamId, acked, clients:Set, lastSerial, lastEventAt, state}
  const clientIds = new Map(); // client -> clientId（per-client 上限用）
  const clientCounts = new Map(); // clientId -> 目前連線數
  let socket = null;
  let upstreamState = STREAM_STATES.IDLE;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let watchdogTimer = null;
  let lastFrameAt = null;
  let lastHeartbeatAt = null;
  let accepting = true;
  let totalClients = 0;

  const redactedLog = (entry) => log(redactForLog({ sessionId, ...entry }));

  function setState(to, { propagate = true } = {}) {
    upstreamState = assertStreamTransition(upstreamState, to);
    if (propagate) {
      for (const sub of subs.values()) {
        if (sub.acked) {
          // 已 ack 的 key 只在「連線層級」的狀態移動：不能倒退成 SUBSCRIBING。
          if (to === STREAM_STATES.RECONNECTING || to === STREAM_STATES.FAILED || to === STREAM_STATES.CLOSED) setKeyState(sub, to);
          continue;
        }
        setKeyState(sub, to);
      }
    }
    broadcastState();
    return upstreamState;
  }

  /* Per-key 狀態（Track A2 / R-025）：一個 key 壞掉不影響其他 key 的 LIVE。
     轉移不合法的情況（例如新 key 跳過 CONNECTING）強制設定並記錄，不中斷 fan-out。 */
  function setKeyState(sub, to) {
    if (!sub) return null;
    if (sub.state === to) return sub.state;
    try {
      sub.state = assertStreamTransition(sub.state ?? STREAM_STATES.IDLE, to);
    } catch {
      redactedLog({ key: sub.key, from: sub.state, to, note: "key-state-forced" });
      sub.state = to;
    }
    for (const client of sub.clients) client.sendState(sub.state);
    return sub.state;
  }

  function broadcastState() {
    for (const sub of subs.values()) {
      const state = sub.state ?? upstreamState;
      for (const client of sub.clients) client.sendState(state);
    }
  }

  function broadcastError(code, message, key = null) {
    const targets = key ? [subs.get(key)].filter(Boolean) : [...subs.values()];
    for (const sub of targets) {
      for (const client of sub.clients) client.sendError(code, message);
    }
  }

  function clearTimer(handle) {
    if (handle !== null && handle !== undefined) {
      try { t.clearTimeout(handle); } catch { /* already fired */ }
    }
  }

  function armWatchdog() {
    clearTimer(watchdogTimer);
    watchdogTimer = t.setTimeout(() => {
      watchdogTimer = null;
      onUpstreamSilence();
    }, UPSTREAM_SILENCE_LIMIT_MS);
  }

  function disarmAll() {
    clearTimer(watchdogTimer);
    watchdogTimer = null;
    clearTimer(reconnectTimer);
    reconnectTimer = null;
  }

  function sendSocket(obj) {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  function ensureSocket() {
    if (socket) return;
    if (typeof webSocketFactory !== "function") {
      throw new StreamError(STREAM_ERROR_CODE.STREAM_UPSTREAM_CLOSED, "無 upstream WebSocket factory（測試需注入，正式環境用 Node 原生 WebSocket）");
    }
    setState(STREAM_STATES.CONNECTING);
    const ws = webSocketFactory(url);
    socket = ws;
    ws.onopen = () => {
      if (socket !== ws) return; // zombie socket: closed/detached, ignore late open
      setState(STREAM_STATES.AUTHENTICATING);
      if (!sendSocket({ event: "auth", data: { apikey: apiKey } })) {
        // Socket died between open and auth: fail fast into the reconnect
        // cycle instead of idling until the watchdog fires.
        try { ws.close?.(); } catch { /* already gone */ }
        return;
      }
      redactedLog({ state: upstreamState, note: "auth-sent" });
      armWatchdog();
    };
    ws.onmessage = (message) => { if (socket !== ws) return; onUpstreamFrame(message?.data ?? message); };
    ws.onerror = () => { /* close event carries the verdict; error itself is transport noise */ };
    ws.onclose = () => { if (socket !== ws && socket !== null) return; onUpstreamClose(); };
  }

  function onUpstreamFrame(raw) {
    lastFrameAt = clock();
    armWatchdog();
    let frame;
    try {
      frame = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      redactedLog({ note: "malformed-frame-dropped" });
      return;
    }
    const kind = classifyUpstreamFrame(frame);
    if (kind === "heartbeat") {
      lastHeartbeatAt = clock();
      return; // liveness only: never touches per-symbol lastEventAt (contract B5)
    }
    if (kind === "pong") return;
    if (kind === "auth-ok") {
      if (upstreamState !== STREAM_STATES.AUTHENTICATING) return;
      setState(STREAM_STATES.SUBSCRIBING);
      for (const [key, sub] of subs) {
        sub.acked = false;
        sendSocket({ event: "subscribe", data: { channel: sub.channel, symbol: sub.symbol } });
      }
      if (subs.size === 0) {
        // Authenticated but nobody left to serve: don't idle a billed
        // upstream socket; close it and park at CLOSED (next subscribe
        // starts a brand-new lifecycle from IDLE).
        teardownSocket();
        setState(STREAM_STATES.CLOSED);
      }
      return;
    }
    if (kind === "auth-error") {
      const error = mapUpstreamError(frame);
      redactedLog({ state: upstreamState, code: error.code, note: "auth-failed-fail-closed" });
      setState(STREAM_STATES.FAILED);
      broadcastError(error.code, "Fugle 認證失敗（key 無效或方案不足），不重試");
      teardownSocket();
      return;
    }
    if (kind === "subscribed") {
      const channel = frame?.data?.channel;
      const symbol = typeof frame?.data?.symbol === "string" ? frame.data.symbol.toUpperCase() : null;
      const key = symbol && SUPPORTED_STREAM_CHANNELS.includes(channel) ? streamKey(symbol, channel) : null;
      const sub = key ? subs.get(key) : null;
      if (sub) {
        sub.acked = true;
        sub.upstreamId = frame?.data?.id ?? sub.upstreamId;
        // per-key LIVE：這個 key 自己的 ack 就進 LIVE，不等別的 key。
        setKeyState(sub, STREAM_STATES.LIVE);
      }
      try {
        if ([...subs.values()].every((s) => s.acked) && upstreamState !== STREAM_STATES.LIVE) setState(STREAM_STATES.LIVE, { propagate: false });
      } catch (error) {
        redactedLog({ note: "global-live-transition-skipped", code: error?.code ?? null });
      }
      return;
    }
    if (kind === "upstream-error") {
      handleUpstreamError(frame);
      return;
    }
    if (kind === "unsubscribed") return;
    if (kind === "data") {
      onUpstreamData(frame);
      return;
    }
    if (kind === "malformed" || kind === "unknown") {
      redactedLog({ note: "upstream-frame-not-routed", kind });
    }
  }

  /* Track A2 / R-025：非認證的 upstream error 不再只記 log。
     能歸屬到 symbol 的錯誤 → 只通知那個 key 的 client、送 STREAM_SUBSCRIBE_FAILED、
     detach 並釋放名額（其他 key 不受影響，仍可到 LIVE）。
     無法歸屬的錯誤 → 廣播錯誤碼給所有 client（不靜默），但不釋放 key。 */
  function handleUpstreamError(frame) {
    const error = mapUpstreamError(frame);
    const symbol = typeof frame?.data?.symbol === "string" ? frame.data.symbol.toUpperCase() : null;
    const key = symbol ? streamKey(symbol, STREAM_CHANNELS.TRADES) : null;
    let sub = key ? subs.get(key) : null;
    if (!sub && !symbol) {
      /* 上游沒有標明是哪個 symbol：若只有一個尚未 ack 的 key，歸因給它
         （最常見情境就是「訂了一個無效代碼」）。仍無法歸因才廣播。 */
      const pending = [...subs.values()].filter((s) => !s.acked);
      if (pending.length === 1) sub = pending[0];
    }
    if (!sub) {
      redactedLog({ code: error.code, note: "upstream-error-unattributed" });
      broadcastError(error.code, error.message);
      return;
    }
    redactedLog({ key: sub.key, code: error.code, note: "upstream-subscribe-failed" });
    failKey(sub, error.code, error.message);
  }

  /* 釋放一個 key：通知 client 錯誤 → detach → 清名額 → 釋出 upstream 訂閱。 */
  function failKey(sub, code, message) {
    const clients = [...sub.clients];
    for (const client of clients) {
      try { client.sendError(code, message); } catch { /* client gone */ }
    }
    for (const client of clients) {
      sub.clients.delete(client);
      totalClients = Math.max(0, totalClients - 1);
      releaseClientCount(client);
    }
    if (socket && sub.acked && sub.upstreamId) {
      try { sendSocket({ event: "unsubscribe", data: { id: sub.upstreamId } }); } catch { /* socket gone */ }
    }
    subs.delete(sub.key);
    if (subs.size === 0) {
      clearTimer(reconnectTimer);
      reconnectTimer = null;
      try { teardownSocket(); } catch { /* already gone */ }
    }
  }

  function releaseClientCount(client) {
    const clientId = clientIds.get(client);
    if (clientId === undefined) return;
    clientIds.delete(client);
    const next = (clientCounts.get(clientId) ?? 1) - 1;
    if (next <= 0) clientCounts.delete(clientId);
    else clientCounts.set(clientId, next);
  }

  function onUpstreamData(frame) {
    const channel = frame?.channel;
    const symbol = typeof frame?.data?.symbol === "string" ? frame.data.symbol.toUpperCase() : null;
    if (!symbol || !SUPPORTED_STREAM_CHANNELS.includes(channel)) return;
    const key = streamKey(symbol, channel);
    const sub = subs.get(key);
    if (!sub || !sub.acked) return;
    let envelope;
    try {
      envelope = normalizeFugleTrade(frame, { symbol, channel, sessionId, receivedAt: clock(), now: clock() });
    } catch (error) {
      redactedLog({ key, code: error?.code ?? "STREAM_SCHEMA_INVALID", note: "trade-normalize-failed" });
      return;
    }
    const seq = checkSequence(sub.lastSerial, envelope.meta.sequence);
    if (seq.status === "duplicate") {
      redactedLog({ key, note: "duplicate-dropped", sequence: envelope.meta.sequence });
      return;
    }
    if (envelope.meta.sequence !== null) sub.lastSerial = envelope.meta.sequence;
    sub.lastEventAt = clock();
    if (sub.state === STREAM_STATES.STALE) setKeyState(sub, STREAM_STATES.LIVE);
    if (upstreamState === STREAM_STATES.STALE) setState(STREAM_STATES.LIVE, { propagate: false });
    for (const client of [...sub.clients]) client.sendTrade(envelope, seq.status);
  }

  function onUpstreamClose() {
    const was = socket;
    socket = null;
    clearTimer(watchdogTimer);
    watchdogTimer = null;
    if (was === null) return;
    if (subs.size === 0 || !accepting) {
      if (upstreamState !== STREAM_STATES.CLOSED && upstreamState !== STREAM_STATES.FAILED) setState(STREAM_STATES.CLOSED);
      return;
    }
    if (upstreamState === STREAM_STATES.FAILED || upstreamState === STREAM_STATES.CLOSED) return;
    setState(STREAM_STATES.RECONNECTING);
    scheduleReconnect();
  }

  function onUpstreamSilence() {
    redactedLog({ state: upstreamState, note: "watchdog-silence" });
    try { socket?.close?.(); } catch { /* already gone */ }
    // onclose handler drives RECONNECTING; if socket never existed, do it here.
    if (socket) return;
    if (subs.size > 0 && accepting && upstreamState !== STREAM_STATES.FAILED && upstreamState !== STREAM_STATES.CLOSED && upstreamState !== STREAM_STATES.RECONNECTING) {
      setState(STREAM_STATES.RECONNECTING);
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    clearTimer(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempt += 1;
    let plan;
    try {
      plan = planReconnect(reconnectAttempt, { maxAttempts: maxReconnectAttempts, baseDelayMs, maxDelayMs });
    } catch (error) {
      setState(STREAM_STATES.FAILED);
      broadcastError(error.code, "重連次數用盡，stream 已 FAILED（需重新訂閱）");
      teardownSocket();
      return;
    }
    redactedLog({ state: upstreamState, attempt: plan.attempt, delayMs: plan.delayMs, note: "reconnect-scheduled" });
    reconnectTimer = t.setTimeout(() => {
      reconnectTimer = null;
      if (subs.size === 0 || !accepting) {
        if (upstreamState !== STREAM_STATES.CLOSED) setState(STREAM_STATES.CLOSED);
        return;
      }
      try {
        ensureSocket();
      } catch (error) {
        setState(STREAM_STATES.FAILED);
        broadcastError(STREAM_ERROR_CODE.STREAM_UPSTREAM_CLOSED, "重連建立失敗");
      }
    }, plan.delayMs);
  }

  function teardownSocket() {
    try { socket?.close?.(); } catch { /* already gone */ }
    socket = null;
    disarmAll();
  }

  /* First subscriber creates/attaches upstream; same-key joins fan out. */
  function subscribe(symbol, channel, client, { clientId = null } = {}) {
    if (!accepting) fail(STREAM_ERROR_CODE.STREAM_UPSTREAM_CLOSED, "stream 已關閉，不再接受訂閱");
    const clean = assertStreamSymbol(symbol);
    const chan = assertStreamChannel(channel ?? STREAM_CHANNELS.TRADES);
    if (totalClients >= maxSseClients) {
      throw new StreamError(STREAM_ERROR_CODE.STREAM_RATE_LIMITED, `SSE clients 已滿（上限 ${maxSseClients}，prototype 級保護）`);
    }
    /* per-client 上限（Track A2 / R-025）：單一來源不能佔滿全域名額。 */
    if (clientId !== null && clientId !== undefined) {
      const used = clientCounts.get(clientId) ?? 0;
      if (used >= maxSseClientsPerClient) {
        throw new StreamError(STREAM_ERROR_CODE.STREAM_RATE_LIMITED, `此用戶的 SSE 連線已滿（上限 ${maxSseClientsPerClient}）`);
      }
    }
    const key = streamKey(clean, chan);
    let sub = subs.get(key);
    if (!sub) {
      if (subs.size >= maxSubscriptionKeys) {
        throw new StreamError(STREAM_ERROR_CODE.STREAM_RATE_LIMITED, `upstream 訂閱已滿（上限 ${maxSubscriptionKeys}，prototype 級保護）`);
      }
      sub = {
        key, symbol: clean, channel: chan, upstreamId: null, acked: false,
        clients: new Set(), lastSerial: null, lastEventAt: null,
        state: initialKeyState(),
      };
      subs.set(key, sub);
    }
    sub.clients.add(client);
    totalClients += 1;
    if (clientId !== null && clientId !== undefined) {
      clientIds.set(client, clientId);
      clientCounts.set(clientId, (clientCounts.get(clientId) ?? 0) + 1);
    }
    if (upstreamState === STREAM_STATES.CLOSED) {
      // Server-level reuse after full cleanup: CLOSED is terminal for one
      // lifecycle, so a brand-new lifecycle restarts from IDLE (not a
      // protocol transition, hence no assertStreamTransition here).
      upstreamState = STREAM_STATES.IDLE;
    }
    if (upstreamState === STREAM_STATES.IDLE || upstreamState === STREAM_STATES.CLOSED || upstreamState === STREAM_STATES.FAILED) {
      reconnectAttempt = 0;
      ensureSocket();
    } else if (socket && socket.readyState === 1 && (upstreamState === STREAM_STATES.LIVE || upstreamState === STREAM_STATES.STALE || upstreamState === STREAM_STATES.SUBSCRIBING)) {
      if (!sub.acked) {
        // New key on an already-authenticated socket: subscribe it explicitly
        // (the auth-ok fan-out only covers keys present then). Global state
        // does NOT flap to SUBSCRIBING — per-key `acked` tracks the rest.
        sendSocket({ event: "subscribe", data: { channel: sub.channel, symbol: sub.symbol } });
        if (sub.state === STREAM_STATES.IDLE) setKeyState(sub, STREAM_STATES.SUBSCRIBING);
      }
    }
    client.sendState(sub.state ?? upstreamState);
    return { key, state: sub.state ?? upstreamState, sharedUpstream: true };
  }

  /* 新 key 的起始狀態：沒有 socket 從 IDLE 起步；socket 已開則沿用當前連線階段。 */
  function initialKeyState() {
    if (!socket) return STREAM_STATES.IDLE;
    if (upstreamState === STREAM_STATES.CONNECTING) return STREAM_STATES.CONNECTING;
    if (upstreamState === STREAM_STATES.AUTHENTICATING) return STREAM_STATES.AUTHENTICATING;
    return STREAM_STATES.SUBSCRIBING;
  }

  function detach(client) {
    let found = false;
    for (const [key, sub] of subs) {
      if (!sub.clients.delete(client)) continue;
      found = true;
      totalClients = Math.max(0, totalClients - 1);
      releaseClientCount(client);
      if (sub.clients.size === 0) {
        subs.delete(key);
        if (socket && sub.acked && sub.upstreamId) sendSocket({ event: "unsubscribe", data: { id: sub.upstreamId } });
        redactedLog({ key, note: "last-client-cleanup" });
      }
      break;
    }
    if (!found) return;
    if (subs.size === 0) {
      clearTimer(reconnectTimer);
      reconnectTimer = null;
      if (upstreamState === STREAM_STATES.RECONNECTING) {
        if (upstreamState !== STREAM_STATES.CLOSED) setState(STREAM_STATES.CLOSED);
      }
      if (socket && upstreamState !== STREAM_STATES.FAILED) {
        teardownSocket();
        if (upstreamState !== STREAM_STATES.CLOSED) setState(STREAM_STATES.CLOSED);
      } else if (upstreamState !== STREAM_STATES.CLOSED && upstreamState !== STREAM_STATES.FAILED && upstreamState !== STREAM_STATES.IDLE) {
        setState(STREAM_STATES.CLOSED);
      }
    }
  }

  function probeStale() {
    if (upstreamState !== STREAM_STATES.LIVE && upstreamState !== STREAM_STATES.STALE) return upstreamState;
    const now = clock();
    let anyFresh = false;
    for (const sub of subs.values()) {
      const stale = isStreamStale({ lastEventAt: Number.isFinite(sub.lastEventAt) ? sub.lastEventAt : null, now, ...(staleAfterMs ? { staleAfterMs } : {}) });
      if (stale) {
        if (sub.state === STREAM_STATES.LIVE) setKeyState(sub, STREAM_STATES.STALE);
      } else {
        anyFresh = true;
        if (sub.state === STREAM_STATES.STALE) setKeyState(sub, STREAM_STATES.LIVE);
      }
    }
    try {
      if (subs.size > 0 && !anyFresh && upstreamState === STREAM_STATES.LIVE) setState(STREAM_STATES.STALE, { propagate: false });
      else if (anyFresh && upstreamState === STREAM_STATES.STALE) setState(STREAM_STATES.LIVE, { propagate: false });
    } catch (error) {
      redactedLog({ note: "global-stale-transition-skipped" });
    }
    return upstreamState;
  }

  function shutdown() {
    accepting = false;
    const clients = totalClients;
    const keys = subs.size;
    for (const sub of subs.values()) {
      for (const client of [...sub.clients]) {
        try { client.close(); } catch { /* client gone */ }
      }
      sub.clients.clear();
    }
    subs.clear();
    clientIds.clear();
    clientCounts.clear();
    totalClients = 0;
    teardownSocket();
    if (upstreamState !== STREAM_STATES.CLOSED) {
      try { setState(STREAM_STATES.CLOSED, { propagate: false }); } catch { upstreamState = STREAM_STATES.CLOSED; }
    }
    return { clients, keys, state: upstreamState };
  }

  function debug() {
    return {
      state: upstreamState,
      sessionId,
      subscriptionKeys: [...subs.keys()],
      keyStates: Object.fromEntries([...subs.values()].map((sub) => [sub.key, sub.state])),
      totalClients,
      clientStreams: Object.fromEntries(clientCounts),
      reconnectAttempt,
      lastHeartbeatAt,
      hasSocket: socket !== null,
    };
  }

  return {
    sessionId,
    subscribe,
    detach,
    probeStale,
    shutdown,
    debug,
    get lastHeartbeatAt() { return lastHeartbeatAt; },
  };
}
