# Delivery Report

## 狀態

- Repository：`https://github.com/waydefu/stock`
- Branch：`main`
- Checkpoint：`604fbba60882a0c79062443ecbca864a97a5ca7b`（PR#9 squash-merge，2026-09-10 UTC）
- GitHub Actions：`Quality` run `34447357364`，對應同一個 SHA，`success`，annotations `0`
- CI action runtime：`checkout@v7.0.1`／`setup-node@v7.0.0`（full SHA pin）使用 Node 24 runtime，並關閉不需要的 package-manager cache。[62][63]
- 本輪合併：PR#9（quant research engine＋professional trading workstation，7 原子提交）；open PR：無
- 工作樹：推送後乾淨

## 做了什麼

- 建立台股／美股研究工作台：儀表板、熱圖、看盤、選股、回測、紙上交易、風控／稽核。
- 建立確定性模擬行情：固定 seed、OHLCV、SMA、RSI、量比與 rolling high；同一標的跨程序可重現。
- 建立回測引擎：收盤形成訊號、下一根開盤成交；顯式手續費、滑價、倉位、回撤、交易明細與模型假設。
- 建立 paper broker：TWD／USD 隔離帳戶、本機持倉／現金／訂單持久化；沒有網路請求，不接真券商。
- 建立 paper execution boundary 與 order state：confirm 時重新驗證帳戶／風控，order 保留 `NEW → VALIDATED → FILLED` transition events；仍明確標為 immediate paper simulation。
- 建立風控：角色權限、單筆名目金額 20% 上限、日損 2% 斷路器、持倉數上限、拒絕代碼、二次確認與稽核 CSV。
- 強化回測：OHLCV validation、equity-peak drawdown percentage、可設定 Sharpe annualization、risk-free 顯式（預設 0）、小樣本 Sharpe 顯示「樣本不足」不採信。
- UI P0：清除 index／runtime inline style，加入 semantic utility tokens、stable canvas baseline、sticky table headers、contrast-safe primary button、purposeful motion 與 safe DOM escaping；programmatic UI gate（`scripts/check-ui.js` 16 checks）鎖住對比／inline／語義／狀態。
- Domain convergence checkpoint：AccountSnapshot、realized／unrealized／total PnL、zero-fee FeeModel、market-local session clock、immediate execution mode、OPEN/CANCELED transition contract、stable error categories、versioned local session audit 與 corrupted-order safe reset。
- MarketRules integration：shared TW/US lot validation 已接到 RiskEngine、PaperBroker 與 UI order intent；TW default odd-lot、regular lot requires explicit 1,000-share multiples。
- Calendar／corporate-action boundary：market-local session、simplified weekday calendar 已接 deterministic data layer；SPLIT／DIVIDEND／CAPITAL_REDUCTION／SYMBOL_CHANGE／DELISTING contract 已定義，但沒有虛構調整資料。
- Test hardening：1,000-intent deterministic accounting fuzz，rejected state preservation、finite equity、position invariants。
- Performance checkpoint：backtest signal arrays precomputed；same Node 24 environment 10,000 bars `827.709ms → 10.299ms`，100,000 bars post-change `50.615ms`。
- Accessibility core：tablist／tabpanel、arrow-key navigation、dialog focus trap／Escape／restore、table column scopes。
- State safety UI：screener empty、backtest error、empty positions/orders/audit blocks 具備 `status`／`alert` semantics 與可行動訊息。
- 行情入口：`js/market-data.js` adapter port（`SimulatedAdapter`），UI／回測經 adapter 取數；自選清單本機持久化（`js/favorites.js`）。
- 交易 UX（advisory-only）：下單票即時試算（`orderEstimate`，不具決策權）、K 線 last-price 虛線、KPI hero 層次。
- 建立 repo 治理：`GOVERNANCE.md`、`CONTRIBUTING.md`、免責聲明、PR 範本與 CI；可照跑收斂計劃書 `docs/FUTURE_PLAN.md`。
- 分層研究引擎（PR#9）：Strategy／Signal 契約＋lifecycle、Cash／Buy&Hold／multi-horizon trend 基準、Portfolio allocator＋capped vol overlay＋hard limits、IS/OOS＋walk-forward＋cost stress＋parameter surface＋promotion gate。
- 策略中心 UI（PR#9）：benchmark 同場比較、gate 顯示、provenance、robustness、IS／OOS 分界曲線；專業快速鍵（/ 1-6 B S ?）與標的搜尋；下單票加整零股＋預估手續費。
- 建立研究文件：`docs/ARCHITECTURE.md`、`docs/UI_UX.md`、`docs/UI_UX_BENCHMARK.md`、`docs/GOVERNANCE.md`；引用 ledger 收錄 93 個來源頁，按模組而非只按產品名稱整理。

## 驗證證據

以下命令在本機 exit code 均為 `0`：

```text
npm run check:static
npm run check:syntax
npm test                 # 107 tests passed
npm run check:ui         # 21 checks passed
npm run score:ui         # 100/100 PASS（靜態可證部分；瀏覽器幾何待補）

git diff --check
git ls-remote origin refs/heads/main
```

瀏覽器 smoke test 使用隔離 Chromium CDP（不碰使用者登入態）：

- `document.title` 正確，初始頁為 `dashboard`。
- dashboard KPI 可渲染；console errors 為 `[]`。
- 看盤頁可切換，Canvas 實際產生寬度。
- 回測頁可切換並顯示淨損益、最大回撤、交易數與 Sharpe。
- Trader 角色可走「預覽 → 風控 APPROVED → 二次確認 → PAPER fill」；訂單與持倉表更新。
- GitHub Actions `Quality` 已在遠端以同一 commit SHA 全綠。

## 研究如何轉成設計

- 市場脈動：Koyfin 的可組態市場資訊、Finviz Matrix 的市值／產業視覺分層、TradingView 的市場掃描。[1][4][6]
- 回測：TradingView 的成本／滑價／成交設定、TrendSpider 的測試到自動化連續性、QuantConnect 的研究／回測／交易管線。[7][8][10][12]
- 紙上交易與 API 邊界：Shioaji、Alpaca、IBKR、cTrader 的模擬、API、訂單 precaution 與 permission 觀念。[25][36][39][41][42][50]
- 台股資料：Fugle 的行情 API、速率限制、K 線與 corporate actions；XQ 的選股／回測／模擬／自動交易循環。[26][27][31][32][33]

完整模組矩陣與來源 URL 在 `docs/ARCHITECTURE.md`；UI 取捨在 `docs/UI_UX.md`。

## 工時與成本

### 可核實的時間範圍

- Repo 初始 `IDEA.md` 時間戳：`2026-09-09 19:38:23 +0800`。
- 第一個 checkpoint commit：`2026-09-09 20:39:13 +0800`。
- 報告整理時的時間快照：`2026-09-09 20:46:43 +0800`。
- 從初始檔案時間戳到報告快照的 wall-clock 下限：**1 小時 08 分 20 秒**。
- 從初始檔案時間戳到第一個 checkpoint：**1 小時 00 分 50 秒**。

這是工作階段的可證明牆鐘下限，不等於 agent 的純 CPU 執行時間；工具等待、研究閱讀與使用者中斷沒有可靠的逐秒 billing log，因此不偽造「精準 active minutes」。

### 成本

- 新增 runtime dependency：`0`；使用既有 Node.js、Python、瀏覽器快取與 GitHub Actions。
- 搜尋／文件抓取：本次可見結果沒有觀測到付費 API 計費；部分無 key backend 直接失敗，沒有用秘密繞過。
- GitHub Actions：run 成功；本環境無法讀取帳號 billing 明細，因此實際 Actions 費用標為**未觀測**。
- 模型／Hermes 平台 token 或訂閱成本：本環境沒有可核實的帳務數字，標為**未觀測**，不估造。

## 尚未做與決策邊界

- 本輪誠實結果：multi-horizon trend 在 2330 模擬資料上 IS −11,888／OOS 零交易→promotion gate FAIL；buyHold IS +206k／OOS −20k；參數平面三格一致、無孤立尖峰。框架按設計拒絕弱證據，不自動晉升任何策略（見 R-019）。
- 本機 Chromium GPU 行程必崩，4 viewport 截圖與瀏覽器幾何閘門延期；替代證據為真實資料端到端＋id-crossref＋ui-score 靜態 100/100（見 R-020）。
- 沒有開啟 `main` branch protection；需要你明確決定是否要求 `Quality` 作為 required check。這是 GitHub 權限設定，不在本次自動修改內。
- 沒有啟用 GitHub Pages／正式部署；部署管線與公開發布需另行決策。
- 沒有接 live Shioaji／Alpaca／IBKR；正式接線前仍需服務端認證、秘密管理、reconciliation、法遵與資料授權。
- 目前是高品質 paper-only prototype，不宣稱 production trading system。

## Sources

[1] https://www.koyfin.com/features
[4] https://finviz.com/blog/the-finviz-matrix-market-breadth-visualized
[6] https://www.tradingview.com/features
[7] https://www.tradingview.com/support/solutions/43000628599-strategy-properties
[8] https://www.tradingview.com/pine-script-docs/concepts/strategies
[10] https://trendspider.com/product/strategy-development-and-backtesting-tools
[12] https://quantconnect.com/docs/v2
[25] https://github.com/sinotrade/shioaji
[26] https://www.xq.com.tw
[27] https://www.xq.com.tw/xsat
[31] https://developer.fugle.tw/docs/data/http-api/getting-started
[32] https://developer.fugle.tw/docs/data/websocket-api/market-data-channels/candles
[33] https://developer.fugle.tw/docs/data/http-api/corporate-actions/capital-changes
[36] https://docs.alpaca.markets/us/docs/paper-trading
[39] https://www.interactivebrokers.com/en/trading/tws.php
[41] https://interactivebrokers.github.io/tws-api/third_party.html
[42] https://interactivebrokers.github.io/tws-api/basic_orders.html
[50] https://help.ctrader.com/ctrader-algo/documentation/plugins
|[62] https://github.com/actions/setup-node/releases/tag/v7.0.0
|[63] https://github.com/actions/checkout/releases/tag/v7.0.1
