# Architecture & Research Synthesis

## 研究結論

本專案不是把 50 個產品的畫面拼在一起，而是把不同工作模組分開研究，再用一條可稽核的資料流整合。[1][4][6] 這份 architecture 研究附錄當時收錄 **61 個來源頁**；目前全專案 research ledger 已擴充到 93 個來源頁，新增 benchmark 與 accessibility／CI evidence 另見 `docs/UI_UX_BENCHMARK.md` 與 `docs/RESEARCH_LEDGER.md`。

### 模組決策矩陣

| 模組 | 參考重點 | 本專案採用 | 明確不學的缺點 |
|---|---|---|---|
| 市場儀表板 | Koyfin 的可組態儀表板與 market movers；Finviz Matrix 的市值／產業視覺分層；TradingView 的熱圖與 screener。[1][4][6] | 上方先顯示市場廣度、熱圖、持倉暴露與異動，再進入單一標的 | 不用大型數字佔滿畫面；不把模擬數字偽裝成即時行情 |
| 圖表與工作區 | TradingView 的跨裝置／多面板 workspace；thinkorswim 的 Monitor／Trade／Analyze／Scan 分區；TC2000 的 chart、watchlist、journal。[9][16][17][44] | 看盤頁把標的、K 線、技術讀數、資料假設放在同一決策面；選標的可回到同一上下文 | 不複製多層選單；不讓下單按鈕與研究讀數互相遮蔽 |
| 選股與研究 | Koyfin 的大量條件、保存 watchlist；Stock Rover 的表格比較、長期基本面；XQ 的台股基本／技術／財務／籌碼欄位。[3][18][19][26][27] | 先用少量核心條件快速篩，再能保存／回看條件；結果直接開到看盤 | 不堆 5,000 個欄位讓新手找不到入口；不把篩選結果當交易訊號 |
| 回測與策略研究 | TradingView 明確列出資金、倉位、手續費、滑價與成交設定；TrendSpider 連接測試到 bot；QuantConnect／VectorBT／Backtrader 拆出研究、組合、成交分析。[7][8][10][12][13][14] | bar close 產生訊號、下一根開盤成交；手續費／滑價非零；回報交易明細、回撤、勝率、Sharpe 與假設 | 不用零成本、未來函數、只看淨利；不宣稱回測等於實盤 |
| 紙上交易與接線 | Alpaca 的 paper/live 差異說明；IBKR 的 paper account、API 狀態與 precautionary settings；Shioaji／Fugle 的台股行情與交易 API。[36][38][39][40][41][43][25][30][31] | paper 是唯一內建執行模式；UI、風控、帳本與未來 broker adapter 分離 | 不在前端放秘密；不把換 endpoint 當成上線；不跳過訂單狀態回讀 |
| 風控與治理 | IBKR 的訂單限制與 API precaution；cTrader plugin 交易需明確 permission；TradeStation 的模擬／API 路徑；XQ 的策略執行紀錄。[41][42][45][50][27] | 角色權限、單筆名目上限、日損斷路器、二次確認、只增稽核日誌、CSV 匯出 | 不允許一般角色關閉風控；不靜默縮單／改價；不以 UI 角色冒充服務端授權 |
| 台股特殊資料 | Fugle 的 candles、速率限制、API key 與 corporate actions；XQ 的多市場／多頻率與策略紀錄；CMoney 的標準化資料 API。[31][32][33][26][27][28][29] | 把資料來源與 corporate actions 列為 adapter 責任；資料狀態要能顯示來源／時間／限制 | 不把第三方抓取資料當成授權 API；不忽略除權息造成的歷史斷裂 |

## 系統資料流

```text
[UI: Monitor / Explore / Operate]
              │
              ▼
[MarketDataAdapter] ──> [deterministic seed data in prototype]
              │
              ├──> [Indicators + Screener]
              ├──> [Backtest: signal at close → fill next open]
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
- `js/accounting.js`：AccountSnapshot、realized／unrealized／daily PnL、zero-fee FeeModel 與 invariants。
- `js/market-rules.js`：TW／US market rules contract；目前 TW partial sourced、US simplified，尚未強制到 broker。
- `js/session-clock.js`：market-local timezone session key；calendar policy 是 `simplified-weekday`，不是 exchange holiday calendar。
- `js/trading-calendar.js`：明確命名的 simplified weekday calendar，供 deterministic data layer 使用。
- `js/corporate-actions.js`：SPLIT／DIVIDEND／CAPITAL_REDUCTION／SYMBOL_CHANGE／DELISTING schema contract；尚未取得或套用調整資料。
- `js/execution-model.js`：立即 paper execution boundary；MATCHING 只保留未實作 contract。
- `js/order-errors.js`：stable order／risk／broker error codes。
- `js/backtest.js`：策略、成交假設、績效統計；不呼叫券商。
- `js/risk.js`：拒絕條件與稽核；拒絕是 fail-closed（失敗時停，不改用較寬鬆路徑）。
- `js/paper.js`：本機紙上帳本；將來 broker adapter 必須維持相同狀態回讀介面。
- `js/order-state.js`：deterministic order status 與 transition event。
- `js/order-service.js`：confirm commit boundary；重新讀帳戶、風控與 paper broker。
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
