# Provider Readiness Matrix（Phase 7A）

> 定位：只做 readiness，不接真 API、不碰憑證。本表每個 claim 皆有官方來源；
> 查不到官方數字的欄位標 `UNVERIFIED`，不猜。查驗日期：2026-09-11。

## Matrix

| Provider | Market | Quote | History | Stream | Paper / Simulation | Secrets backend required | Limits verified | Status |
|---|---|---|---|---|---|---|---|---|
| Fugle 行情 API v1.0 | TW（TWSE／TPEx／TAIFEX） | REST 日內行情＋快照 [109] | REST 歷史行情 [109] | WebSocket 即時行情 [109] | 無 paper（行情 API 非交易；交易 API 已於 2025/11 sunset，轉合作券商 SDK [30]） | API key 必須放 trusted proxy，Pages 不可持 key（單帳號政策 [109]） | 部分：免費額度存在但速率數字 UNVERIFIED | **FIRST CANDIDATE（TW）** |
| Shioaji v1.7.5（2026-09-10）[111] | TW | quote.subscribe（tick／bidask）[110] | ticks／kbars／snapshots [110] | socket／SSE（heartbeat 診斷 [112]） | simulation mode ✓；sim 單不支援興櫃／零股 [110] | API key＋secret＋憑證，必須本機可信 process／server [110] | 部分：超流回空值 [112]；數字配額 UNVERIFIED | 次選（需本機可信環境，不適合純靜態起手） |
| Alpaca Market Data API | US（IEX／SIP） | REST＋WS [113] | 自 2016 [113] | WS（Basic 30 symbols／Plus unlimited）[113] | paper 環境 ✓（獨立 key＋endpoint；paper-only 限 IEX）[114] | key／secret headers，server-side [113][115] | 已驗證：Basic IEX 200/min、Plus SIP 10k/min、429＋exponential backoff 官方指引 [113][115] | US-only，無 TW；TW 需求下不選 |
| IBKR TWS API | US／global | 需 L1 top-of-book 訂閱 [118] | 有（soft throttle；BID_ASK 雙計）[116] | TWS／Gateway session | paper ✓（top-of-book 模擬成交；無 VWAP／auction／RFQ 等）[117] | credentials＋TWS session，server-side | 已驗證：pacing 預設 50 req/s [116] | 重量級，deferred |

## Recommendation

**FIRST REAL DATA ADAPTER：Fugle（TW 行情）。**

- TW relevance：TWSE／TPEx／TAIFEX 官方來源，台股唯一真資料候選。
- API fit：REST（快照／歷史）＋WebSocket（即時）分離，與本 repo transport／capability 分層直接對應。
- JS/static fit：官方 Node.js 函式庫存在，跑在 trusted proxy 側，Pages 只收正規化後資料。
- Historical：REST 歷史行情 ✓；realtime：WS ✓。
- Cost／entitlement：免費額度有使用規範與單帳號政策 [109]；細節費率開通前重查。
- Rate limits：官方速率數字 UNVERIFIED——本 repo 已備 Retry-After 優先＋bounded backoff，實接時以官方表為準。
- Auth complexity：key 制，比 Shioaji 憑證制、IBKR session 制輕。
- Licensing：TWSE 交易資訊使用管理辦法約束（禁轉售／再授權）[109]；原型研究自用合規，公開服務前重審。
- Maintenance：行情 v1.0 文件 2026-01 更新 [109]；交易 API sunset 證明 Fugle 會斷舊版——adapter 必須釘版本＋contract 測試鎖住。

**架構鐵律（7B 前提）：Browser → trusted proxy → Fugle，絕非 Browser 直連夾 key。**
Shioaji 留給未來本機可信 process（憑證＋下單同環境）；Alpaca 只在 US 需求出現時重評；IBKR 不在本路線。

## Non-goals（本輪未做）

真憑證、真連線、OAuth、CA 憑證處理、Shioaji production 登入、Fugle production key、
Alpaca live order、IBKR order submit、fundamentals 實作、server 部署。
