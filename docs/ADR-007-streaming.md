# ADR-007: Phase 7C Streaming Transport Decision

## Status

Accepted（2026-09-11；PR1 只做 contract＋fake，本決策約束後續 bridge／smoke／UI 三支 PR。）

## Context

7A 建立 provider-neutral REST 契約，7B 接通 Fugle REST＋Render trusted proxy。
7C 要把即時行情推進 browser，但 Fugle WebSocket 認證是連線後送
`{event:"auth", data:{apikey}}`（官方 getting-started，2026-09-11 實讀），
所以 browser 絕不能直連 Fugle upstream：key 會進前端。

## Official facts（2026-09-11 實讀，非記憶）

- 連線：`wss://api.fugle.tw/marketdata/v1.0/stock/streaming`
- 認證：送 `{event:"auth", data:{apikey}}` → `authenticated`／`error(Invalid authentication credentials)`
- 心跳：server 每 30s 送 `{event:"heartbeat", data:{time}}`；另有 ping／pong（state 可選）
- 訂閱：`{event:"subscribe", data:{channel, symbol|symbols, intradayOddLot?}}` → `subscribed{id, channel, symbol}`
- 資料：`{event:"data", data:{symbol, type, exchange, market, time(number), serial(流水號), bid, ask, price, size, volume, isTrial, …}, id, channel}`
- 頻道：trades／candles／books／aggregates／indices（首波範圍只用 trades）
- 來源：`docs/data/websocket-api/getting-started`（頁面標示 Last updated Jan 9, 2026）、
  `docs/data/websocket-api/market-data-channels/trades`

## Decision

**Option A：Render server 持 upstream WebSocket → browser 走 SSE。**

- Upstream 端用 Node 24 原生 `WebSocket` client（`node -e` 已驗 `typeof WebSocket === "function"`，
  無需 `ws`／`tungstenite` 類依賴，符合 low-dependency 政策）。
- Browser 端用既有 `node:http` proxy 加 SSE 端點（`text/event-stream`），
  與現有 CORS allowlist／rate limiter／secret-guard 同一程序、同一政策。
- 需求是 server→browser 單向 market events；SSE 足夠，不為「炫」加 server WebSocket 依賴。

## Rejected

- **Option B（server WebSocket bridge 到 browser）：** 需要 `ws` 等新 runtime 依賴＋
  瀏覽器雙向通道管理；單向行情用不到 browser→server 訊息（訂閱走現有 REST 形態端點即可）。
  若未來需要 browser→server 雙向（如動態多 symbol 訂閱且 SSE＋REST 不足），另開 ADR 重估。
- **Browser 直連 Fugle WS：** 違反 secret boundary（key 必進前端），永久否決，
  即使官方提供 browser example 亦然。

## Bridge update（PR2b，2026-09-12）

- 實作：`server/fugle-stream-manager.js`（單一 upstream＋registry fan-out）＋
  `server/stream-sse.js`（`text/event-stream`、keepalive comment、slow-client 摘除）＋
  `GET /api/market/stream?symbol=`（channel 固定 trades、symbol 接受 PR#26 runtimeSymbol 類任意碼）。
- Fan-out：subscription key `FUGLE:TW:{symbol}:trades`；同 key 一條 upstream→N SSE clients；
  最後 client 離開即 `unsubscribe(id)`＋關 socket＋清 timers（測鎖）。
- Keepalive／heartbeat／freshness 三分離：SSE `: keepalive`（20s）≠ upstream 30s heartbeat ≠
  envelope market freshness；watchdog 75s 無 frame 即重連。
- Reconnect：沿用 contract（5次／1s退避／30s cap→FAILED）；重連必 re-auth＋resubscribe；
  auth 失敗 fail-closed 不重試；零 clients 時不重連。
- Anti-abuse：沿用 REST 120/min 計數＋max 50 SSE clients＋max 20 keys，超限 429 STREAM_RATE_LIMITED。
- Backpressure：write false→只摘除該慢 client（測鎖），不斷 fan-out。
- time 單位：官方 trades 例 `time:1685338200000000` 為微秒→轉 ms（測鎖，非猜測）。
- realtimeStream 維持 false（待 PR3 REAL_STREAM_SMOKE＋browser acceptance）。

## Consequences

- PR1（本支）：`js/stream-contract.js`（9 states、envelope、heartbeat≠freshness、
  bounded reconnect、7 個 STREAM_* codes、redactForLog）＋`js/fake-stream-provider.js`＋22 tests。
  不碰 server／proxy／UI／adapter capability（`realtimeStream:false` 維持，直到 bridge PR）。
- PR2（server bridge）：upstream auth／subscribe／heartbeat／reconnect／abort／cleanup、
  SSE 端點、fan-out 決策（預設：同 symbol 共享 upstream subscription；若不做，文件明寫限制）。
- PR3（real smoke＋最小 UI）：trusted env 跑 REAL_STREAM_SMOKE，CI 無 key 則 BLOCKED_BY_CREDENTIAL。
- REST／stream 降級必須顯式標 `source`（如 `FUGLE_REST_SNAPSHOT`），禁 mixed provenance 不標示。
- Stream data 永遠 ≠ trading trigger（不接 PaperBroker／OrderService）。
