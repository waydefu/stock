# 架構研究矩陣

## 模組職責邊界

```text
[UI: Monitor / Explore / Operate]
              │
              ▼
[MarketDataAdapter] ──> [SimulatedAdapter | FugleProxyAdapter]
              │
              ├──> [Indicators + Screener]
              ├──> [Backtest: signal at close → fill next open]（legacy 相容路徑）
              ├──> [Research: Strategy → Signal → Portfolio → next-bar-open]
              │         ├──> [IS / OOS + walk-forward + cost stress + parameter surface]
              │         └──> [Promotion gate → lifecycle（不自動進 paper）]
              └──> [PaperBroker]
                         ▲
                         │ only after
                  [RiskEngine + RBAC + confirmation]
                         │
                         ▼
                       [AuditLog]

[Browser 端即時串流] ──SSE──> [trusted proxy (server/)] ──WebSocket──> [Fugle]
                                ▲ holds FUGLE_API_KEY（頁面永遠不持金鑰）
```

### 邊界

- `js/data.js`：固定模擬資料與純技術指標（模擬窗固定 2025 終點）；不是整個系統唯一行情來源。
- `js/market-data.js`：本機 `SimulatedAdapter`；`js/fugle-proxy-adapter.js` 是真實 Fugle REST adapter。UI／研究透過 provider-neutral 契約取得資料；capability／envelope／provenance／freshness 定義在 `js/market-data-contract.js`。
- `js/market-data-contract.js`：provider-neutral envelope／freshness／retry／transport 契約與 bar 缺棒分類（`classifyBars`）。
- `js/accounting.js`：AccountSnapshot、realized／unrealized／daily PnL、FeeModel 契約與 invariants、每期利率換算（`perPeriodRate`）。**backtest slippage（`slippageBps`）是歷史模擬假設；paper fees（`FeeModel`）是執行模型。兩者名稱相似但實作分開、互不干涉。**
- `js/market-rules.js`：TW／US market rules contract；TW sourced tick／limit／session 由 RiskEngine 在 commit boundary 強制驗證；商品別 tick 表（股票／ETF／ETN／REIT／封閉型基金／權證）可選傳入 `instrumentType`；漲跌停以整數最小單位計算。US 維持 simplified，不套 TW 規則。
- `js/session-clock.js`：market-local timezone session key；calendar policy 由 `js/trading-calendar.js` 提供。
- `js/trading-calendar.js`：`SimplifiedWeekdayCalendar`（只看星期幾，供 deterministic data layer）與 `MarketHolidayCalendar`（台股用 TWSE 官方休市日快照，涵蓋範圍外退回 weekday 規則並在 policy 明講）。
- `js/tw-market-holidays.js`：TWSE「市場開休市日期」官方快照（2026 年度），含來源與查閱日期。
- `js/corporate-actions.js`：SPLIT／DIVIDEND／CAPITAL_REDUCTION／SYMBOL_CHANGE／DELISTING schema contract；尚未取得或套用調整資料。
- `js/execution-model.js`：立即 paper execution boundary；MATCHING 只保留未實作 contract。
- `js/order-errors.js`：stable order／risk／broker error codes。
- `js/order-candidate.js`：純函式下單候選組裝（UI 與測試共用；帶 `referencePrice` 與商品別），避免 preview／confirm 組單不一致。
- `js/classic-strategies.js`：MA／RSI／Breakout 的唯一訊號語義；legacy `runBacktest()` 與分層 Strategy adapter 共用，避免兩套規則漂移。
- `js/backtest.js`：legacy sizing／execution／metrics 相容路徑；內建策略訊號已不再自行實作。新研究走 `js/research.js`；待 UI 全面切換後再退役 legacy execution。
- `js/strategy.js`：Strategy／Signal 契約、long-only 映射、註冊表、生命週期門（新策略不得自動進 paper）。
- `js/alpha.js`：研究基準庫（cash／buyHold／multi-horizon trend，皆有 hypothesis＋warmup）。
- `js/portfolio.js`：Allocator、capped 波動目標覆蓋、組合硬上限（reason coded）。
- `js/research.js`：分層研究引擎——Signal→target exposure→next-bar-open；IS/OOS、walk-forward、cost stress、parameter surface、promotion gate；target 依實際成交更新。
- `js/risk.js`：拒絕條件與稽核；拒絕是 fail-closed（失敗時停，不改用較寬鬆路徑）；斷路器狀態寫入 versioned localStorage。
- `js/paper.js`：本機紙上帳本；constructor 的 FeeModel 可注入，預設 zero-fee 只作 domain/test default。
- `js/paper-fee-model.js`：正式 forward-test 成本政策；TW dispatch 到 sourced FeeModel，US 在尚無來源化非佣金成本前明示 zero-fee；不猜當沖資格。
- `js/paper-runtime.js`：App composition boundary，負責把 runtime fee policy 注入 PaperBroker。
- `js/order-state.js`：deterministic order status 與 transition event。
- `js/order-service.js`：confirm commit boundary；重新讀帳戶、風控與 paper broker。
- `js/favorites.js`：自選清單本機持久化；寫入失敗不影響交易主流程。
- `js/view.js`：純顯示 helper（含 advisory-only `orderEstimate` 試算，不具決策權）；XSS 關鍵路徑由單測鎖住。
- `js/app.js`：UI composition root；Live stream lifecycle 已移到 `js/app-stream-controller.js`。仍需續拆交易／研究／導覽 controller，重構不得改變交易語義。
- `js/app-stream-controller.js`：Live SSE UI/controller；只碰 `#stream-*` DOM 與 `SseStreamClient`，gate 明確禁止接觸 PaperBroker／order-service／RiskEngine。
- `js/app-risk-audit-controller.js`：Risk/Audit presentation；只讀 `risk.status()`／`audit.list()` 與 CSV export，gate 禁止 `approveOrder`、下單、`trip/reset`。
- `js/stream-contract.js`：provider-neutral 串流契約（狀態機、序號、錯誤碼、遮蔽、stale 政策）。
- `js/sse-stream-client.js`：browser 端 SSE client；傳輸／上游／市場新鮮度三種 liveness 分離，generation guard 防 symbol 污染。
- `js/fugle-proxy-adapter.js`／`js/fixture-provider.js`／`js/providers/fugle-mapper.js`：真實行情 adapter 與 Fugle schema 映射（唯一懂 Fugle 格式的地方）。
- `js/proxy-config.js`：公開 runtime config（proxy URL，非秘密）注入點。
- `server/market-proxy.js`：trusted proxy HTTP routing／CORS／Fugle REST orchestration；日誌只留雜湊 client id。
- `server/proxy-anti-abuse.js`：純 anti-abuse state——per-client token bucket、quote 短 TTL 快取、每日上游預算與 bounded maps；無 HTTP／provider schema／秘密。
- `server/fugle-stream-manager.js`：Fugle WebSocket 管理器——單一上游多訂閱、per-client SSE 上限、per-key 狀態、upstream 錯誤路由與名額釋放。
- `server/stream-sse.js`：瀏覽器端 SSE 序列化（只送 normalized envelope）。
- `server/start-market-proxy.js`：正式 entrypoint——fail-fast 設定、STALE 探測排程、graceful shutdown。

## 架構取捨

1. **原生 JavaScript 而非大型框架**：這個原型要能直接開啟與 GitHub Pages 部署，先降低依賴與供應鏈爆炸半徑；若未來進入多人服務，再以需求決定框架，不預先引入 runtime 依賴。
2. **Canvas 而非第三方圖表套件**：目前只需可重現 K 線／權益曲線，避免把授權、版本與包體積帶進最小原型；若要做 tick／order-book，應另提架構決策。
3. **前端角色只是 UX 狀態**：真正的 RBAC、秘密、風控、訂單 reconciliation 必須在服務端；本 repo 不把 prototype 冒充 production。
4. **研究證據與交易動作分離**：選股與回測可以產生研究結果，但不能直接呼叫 paper broker，更不能繞過風控。

## 研究來源索引（按模組）

- 市場／儀表板：[1][2][4][5][6][9][16][18][20][54][55][56][57][58][59]
- 選股／基本面／台股資料：[3][18][19][26][27][28][29][30][31][32][33][34][35]
- 回測／策略／自動化：[7][8][10][12][13][14][15][17][21][22][23][24][47][48][49][60]
- 下單／紙上交易／API：[25][30][36][37][38][39][40][41][42][43][45][46][50][51][52][53]
- 投資研究與風險教育：[44][55][56][57][58][59][60][61]

來源 URL 由引用工具依本文實際引用的編號自動產生，避免手工重打造成錯鏈。

## Sources

[1] https://www.koyfin.com/features
[2] https://www.koyfin.com/for-investors/equity-research
[3] https://www.koyfin.com/features/stock-screener
[4] https://finviz.com/blog/the-finviz-matrix-market-breadth-visualized
[5] https://finviz.com/elite
[6] https://www.tradingview.com/features
[7] https://www.tradingview.com/support/solutions/43000628599-strategy-properties
[8] https://www.tradingview.com/pine-script-docs/concepts/strategies
[9] https://www.tradingview.com/desktop
[10] https://trendspider.com/product/strategy-development-and-backtesting-tools
[12] https://quantconnect.com/docs/v2
[13] https://vectorbt.dev
[14] https://github.com/Backtrader/Backtrader
[15] https://www.quantrocket.com
[16] https://www.tc2000.com/features/overview
[17] https://www.tc2000.com/features/version20
[18] https://www.stockrover.com/stock-charting
[19] https://www.stockrover.com/stock-rovers-top-5-features-transcript
[20] https://simplywall.st
[21] https://github.com/Freqtrade/freqtrade
[22] https://docs.freqtrade.io/en/stable
[23] https://hummingbot.org/strategies/v2-strategies
[24] https://hummingbot.org
[25] https://github.com/sinotrade/shioaji
[26] https://www.xq.com.tw
[27] https://www.xq.com.tw/xsat
[28] https://www.xq.com.tw/xstrader/xslearnmap
[29] http://app.cmoney.tw
[30] https://developer.fugle.tw/docs/trading/intro
[31] https://developer.fugle.tw/docs/data/http-api/getting-started
[32] https://developer.fugle.tw/docs/data/websocket-api/market-data-channels/candles
[33] https://developer.fugle.tw/docs/data/http-api/corporate-actions/capital-changes
[34] https://developer.fugle.tw/blog/2022-11-18-week7-ma-increase-position-strategy
[35] https://developer.fugle.tw/blog/2022-12-30-week10-multiple-investment-strategy
[36] https://docs.alpaca.markets/us/docs/paper-trading
[37] https://docs.alpaca.markets/us/docs/alpaca-api-platform
[38] https://alpaca.markets/learn/start-paper-trading
[39] https://www.interactivebrokers.com/en/trading/tws.php
[40] https://www.interactivebrokers.com/en/trading/ib-api.php
[41] https://interactivebrokers.github.io/tws-api/third_party.html
[42] https://interactivebrokers.github.io/tws-api/basic_orders.html
[43] https://www.interactivebrokers.com/campus/trading-lessons/python-placing-orders
[44] https://welcome.schwab.com/content/introduction-to-thinkorswim-desktop-platform
[45] https://developer.tradestation.com
[46] https://www.tradestation.com/platforms-and-tools
[47] https://www.metatrader5.com/en/automated-trading
[48] https://docs.ninjatrader.com/ninjascript.md
[49] https://www.ninjatrader.com/trading-platform
[50] https://help.ctrader.com/ctrader-algo/documentation/plugins
[51] https://developer.oanda.com
[52] https://www.developer.saxo/openapi/learn/order-placement
[53] https://www.sierrachart.com
[54] https://moomoo.com/us/invest/trading-platform
[55] https://finance.yahoo.com/research/?fr=sycsrp_catchall
[56] https://seekingalpha.com
[57] https://www.google.com/finance
[58] https://www.investing.com
[59] https://www.morningstar.com
[60] https://www.aaii.com/journal/article/536490-using-portfolio-visualizer-to-test-allocation-strategies
[61] https://www.portfolioglance.com/investing-apps/simply-wall-st-vs-stock-rover