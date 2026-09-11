# Fugle REST Adapter（Phase 7B1）

> 真資料第一次進 boundary：Browser → trusted proxy → Fugle REST → 7A 正規化。
> WebSocket 留 7C。本文件所有 Fugle 規格皆有官方出處（查驗 2026-09-11）。

## Architecture

```text
Pages Browser (FugleProxyAdapter, 無 secret)
  ↓ GET /api/market/quote?symbol= /api/market/bars?symbol=&from=&to=
Trusted proxy (server/market-proxy.js, Node 24 http, FUGLE_API_KEY 只在 process env)
  ↓ GET api.fugle.tw/marketdata/v1.0/stock/... + X-API-KEY
Fugle Market Data REST v1.0
```

映射集中在 `js/providers/fugle-mapper.js`（browser 與 proxy 共用）；
proxy 與 browser 各做一次 7A `normalize`（縱深驗證，皆冪等）。

## Secret boundary

- key 只存在 trusted process env（`FUGLE_API_KEY`）；缺席 → 503 `AUTH_REQUIRED`，fail closed。
- browser adapter 建構子拒收任何秘密 key（含巢狀），`assertBrowserSafeConfig` 鎖死。
- proxy log 只記 requestId／route／symbol／status／domainCode／latency／attempts；
  不記 headers／env／body。錯誤回 browser 的只有穩定 `{code, message, requestId}`。
- `check-ui` 閘 `no-adapter-secrets`＋`fugle-boundary` 常駐。

## REST endpoints used（官方）

- `GET /intraday/quote/{symbol}`（`?type=oddlot` 本輪不用）：price 取 `lastPrice`，
  previousClose／change／changePercent 照給，volume 取 `total.tradeVolume`，
  時間取 `lastUpdated`（微秒 → `Math.floor(us/1000)`，sourced conversion）。
- `GET /historical/candles/{symbol}?from&to&timeframe=D&fields=open,high,low,close,volume,change&sort=asc`：
  日 K `date`（yyyy-MM-dd，台北日界）→ 當日 00:00+08:00 毫秒；
  日 K volume 單位為股（官方）；`adjusted=false` 固定 → `adjustmentMode: "unadjusted"`
 （回應若帶 `adjusted: true` 則以回應為準）。
- 官方限制（本 repo mirror）：區間需 <1 年、from≤to（否則 400→`DATA_INVALID`）；
  查無資料 404→`INVALID_SYMBOL`；401/403→`AUTH_FAILED`；429→`RATE_LIMITED`。

## Normalization／freshness

- quote → `normalizeQuote`（缺 `lastPrice` 即 `DATA_INVALID`；缺欄 null 不偽造）；
  bars → `normalizeBars`＋`validateBars`＋`classifyBars`。
- quote envelope `dataKind: realtime`；bars `dataKind: historical`＋freshness UNKNOWN
 （7A 語義：歷史無 liveness，不判 STALE）。
- `pointInTime: unknown`、`adjustmentMode` 如上；research provenance 全帶出。

## Retry／timeout／CORS

- 沿用 7A `retryOperation`＋classifier（只重試 TIMEOUT／RATE_LIMITED／PROVIDER_UNAVAILABLE）；
  upstream Retry-After → `details.retryAfterMs` → 實際 sleep（全鏈路測試鎖死）。
- 硬超時 10s（repo policy，非官方規則）：AbortController＋race 雙保險，不永久 hang。
- GET only（他法 405）；CORS allowlist 僅 Pages origin＋localhost；無 wildcard；
  無上游 URL 參數（open proxy 不可能）。

## Limitations（誠實）

- real market data ≠ live trading；real-data paper ≠ real execution。
- historical ≠ point-in-time fundamentals；`pointInTime: unknown`。
- Fugle 授權可能限制公開再散佈；TWSE 交易資訊辦法約束仍適用。
- Pages 不持憑證；proxy 未部署時 Fugle 模式明確不可用，不偽裝成功。
- WebSocket realtime streaming 未實作（7C）。

## UI 模式（7B2）

- 紙上交易頁 `資料來源` 切換：模擬行情（預設）／Fugle 真實行情，需明確切換。
- 真實行情卡：報價查詢（symbol／last／prev／change／pct／volume／provider＋收到時間／freshness／時段／provider 狀態）與「抓真實日 K 跑研究」
 （Multi-Horizon Trend 20/60/120、IS／OOS、walk-forward、cost stress、Buy&Hold 同資料基準、promotion gate），全標 REAL DATA＋PAPER EXECUTION。
- 失敗（未切模式／未設 proxy／AUTH／限流／逾時／資料不足）皆為明確 error state，
 維持 Fugle 模式，永不切回模擬。下單票價格仍為模擬，執行永遠 PAPER。

## Smoke（7B2）

- `npm run smoke:fugle`：本機 proxy＋key 的只讀 smoke（無 key → BLOCKED_BY_CREDENTIAL exit 2）。
- `npm run smoke:fugle:remote`：已部署 proxy 的 quote smoke（需 `MARKET_DATA_PROXY_URL`，無則 BLOCKED_BY_PROXY exit 2）。
- `npm run smoke:research:fugle`：真 bars → 全研究鏈，stdout `REAL_RESEARCH_SMOKE PASS …`（invariants only；無 key → BLOCKED_BY_CREDENTIAL exit 2）。

## Real smoke procedure

```bash
FUGLE_API_KEY=... node server/market-proxy.js  # 只在本機可信終端，不進 repo/CI/chat
npm run smoke:fugle  # 無 key 時印 BLOCKED_BY_CREDENTIAL 並 exit 2
```

只驗 invariants（price finite、symbol 正確、bars ascending、OHLC 合法），
禁止把 live 價格寫進測試斷言。
