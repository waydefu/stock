# 架構研究矩陣

## 模組職責邊界

```text
[UI: Monitor / Explore / Operate]
              │
              ▼
[MarketDataAdapter] ──> [deterministic seed data in prototype]
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
```

### 邊界

- `js/data.js`：資料與純技術指標；目前只提供固定模擬資料。
- `js/market-data.js`：行情入口；UI／回測只經 adapter 取數。7A 起附 capability／envelope／provenance／freshness 契約（`js/market-data-contract.js`）；live adapter 照同介面替換。
- `js/accounting.js`：AccountSnapshot、realized／unrealized／daily PnL、zero-fee FeeModel 與 invariants。**backtest slippage（`slippageBps`）是歷史模擬假設；paper fees（`FeeModel`）是執行模型。兩者名稱相似但實作分開、互不干涉。**
- `js/market-rules.js`：TW／US market rules contract；TW sourced tick／limit／session 由 RiskEngine 在 commit boundary 強制驗證（PR#12 起）；US 維持 simplified，不套 TW 規則。
- `js/session-clock.js`：market-local timezone session key；calendar policy 是 `simplified-weekday`，不是 exchange holiday calendar。
- `js/trading-calendar.js`：明確命名的 simplified weekday calendar，供 deterministic data layer 使用。
- `js/corporate-actions.js`：SPLIT／DIVIDEND／CAPITAL_REDUCTION／SYMBOL_CHANGE／DELISTING schema contract；尚未取得或套用調整資料。
- `js/execution-model.js`：立即 paper execution boundary；MATCHING 只保留未實作 contract。
- `js/order-errors.js`：stable order／risk／broker error codes。
- `js/backtest.js`：策略、成交假設、績效統計；不呼叫券商。legacy 融合迴圈（相容保留，見 R-021）；新研究走 `js/research.js`。
- `js/strategy.js`：Strategy／Signal 契約、long-only 映射、註冊表、生命週期門（新策略不得自動進 paper）。
- `js/alpha.js`：研究基準庫（cash／buyHold／multi-horizon trend，皆有 hypothesis＋warmup）。
- `js/portfolio.js`：Allocator、capped 波動目標覆蓋、組合硬上限（reason coded）。
- `js/research.js`：分層研究引擎——Signal→target exposure→next-bar-open；IS/OOS、walk-forward、cost stress、parameter surface、promotion gate。
- `js/risk.js`：拒絕條件與稽核；拒絕是 fail-closed（失敗時停，不改用較寬鬆路徑）。
- `js/paper.js`：本機紙上帳本；將來 broker adapter 必須維持相同狀態回讀介面。
- `js/order-state.js`：deterministic order status 與 transition event。
- `js/order-service.js`：confirm commit boundary；重新讀帳戶、風控與 paper broker。
- `js/favorites.js`：自選清單本機持久化；寫入失敗不影響交易主流程。
- `js/view.js`：純顯示 helper（含 advisory-only `orderEstimate` 試算，不具決策權）；XSS 關鍵路徑由單測鎖住。
- `js/app.js`：UI 組裝；不應直接保存或處理秘密。

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