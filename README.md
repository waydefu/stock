# 台美股自動交易網頁（TW/US Auto Trading Web）

繁體中文的台股＋美股分析與模擬自動交易單頁應用（SPA）。
純靜態、零依賴、免建置：直接用瀏覽器開 `index.html` 或走 GitHub Pages 即可跑。

> **定位**：研究／教育用原型（prototype）。預設行情是本機種子生成的**模擬資料**；
> 可切換到 **Fugle 真實行情**（經部署端的 trusted proxy，僅供研究）。
> 下單全部走紙上交易（paper trading），**不連真實券商、不給投資建議**。
> 詳見 `DISCLAIMER.md`。

## 功能（對應 50 家專家產品的綜合）

| 頁籤 | 學誰 | 做什麼 |
|---|---|---|
| 儀表板 | Koyfin／Finviz Matrix | 市場熱圖（市值加權方塊、漲跌著色）、大盤重點、自選報價 |
| 看盤 | TradingView／XQ／富果 | K 線圖＋MA20/50＋成交量＋last-price 線、自選清單（本機持久化）、盤勢資訊 |
| 選股 | Finviz／XQ／Stock Rover | 漲跌幅、量比、本益比、殖利率等多條件篩選 |
| 回測 | TradingView 策略測試器／TrendSpider | MA 交叉、RSI、突破三策略；手續費＋滑價預設非零；樣本數過少警告（學 TradingView 的坑）；研究策略走分層引擎：Cash／Buy&Hold 基準、多 horizon 趨勢、IS／OOS、walk-forward、cost stress、promotion gate |
| 策略中心 | QuantConnect 研究框架精神 | 基準永遠同場比較、OOS 分段顯示、參數平面、provenance；gate FAIL 明示、不自動晉升 paper |
| 交易 | Alpaca／Shioaji 模擬單 | 紙上即時模擬成交（非真實限價撮合；台股 TWD 100 萬、美股 USD 10 萬分帳）、持倉損益、下單票即時試算（advisory-only，不具決策權） |
| 風控 | IB TWS／QuantConnect | 單筆上限、日損斷路器（kill switch）、下單二次確認、稽核日誌（audit log）可匯出 CSV |
| 治理 | Linear／Stripe 設計治理 | 角色（RBAC：觀察者／交易員／風控官／管理員）、深色 fintech 設計代幣（design tokens）、專業快速鍵（/ 搜尋、1–6 頁籤、B／S 開單、? 說明） |

## 架構

```
index.html          單頁殼＋六頁籤
css/styles.css      設計代幣＋元件（深色數據密度風）
js/data.js          種子隨機行情產生器（mulberry32，確定性、可重現）
js/accounting.js    AccountSnapshot、invariants、zero-fee paper FeeModel
js/execution-model.js Immediate／future matching execution boundary
js/order-errors.js  stable risk／validation／broker error codes
js/dom.js           safe DOM text escaping helper
js/market-data.js   本機 SimulatedAdapter；真實 Fugle 走 fugle-proxy-adapter.js
js/favorites.js     自選清單本機持久化（不影響帳本）
js/view.js          純顯示 helper（金額／狀態塊／標籤，無 DOM）
js/market-rules.js  TW／US 市場規則 contract（TW partial sourced、US simplified）
js/session-clock.js market-local timezone session key；calendar policy 明確是 simplified-weekday
js/trading-calendar.js TWSE 2026 休市日＋市場時區；US 仍 simplified weekday
js/corporate-actions.js corporate-action schema contract；不自動調整價格
js/charts.js        Canvas K 線／權益曲線（無圖表庫依賴）
js/backtest.js      回測引擎（bar-close 評估、次根開盤成交、無未來函數；legacy 相容路徑，見 R-021）
js/strategy.js     Strategy／Signal 契約、long-only 映射、註冊表、生命週期門
js/alpha.js        研究基準庫（cash／buyHold／multi-horizon trend，皆有假說）
js/portfolio.js    Allocator、capped 波動目標覆蓋、組合硬上限
js/research.js     分層研究引擎（IS/OOS、walk-forward、cost stress、parameter surface、promotion gate）
js/paper.js         紙上交易帳本（localStorage 持久化）
js/order-state.js   訂單狀態機與 transition event
js/order-service.js 執行邊界（confirm 時重新讀帳戶與風控）
js/risk.js          風控＋稽核日誌
js/app.js           UI orchestration 聚合點（待拆 controller／renderer；不持秘密）
js/order-candidate.js  純函式下單候選組裝（UI 與測試共用，帶參考價與商品別）
js/stream-contract.js  provider-neutral 串流契約（狀態機、序號、錯誤碼、遮蔽）
js/sse-stream-client.js browser 端 SSE client（三種 liveness 分離、generation guard）
js/fugle-proxy-adapter.js 經 proxy 取真實行情的 adapter（頁面不持金鑰）
server/             trusted proxy（REST＋SSE）、Fugle WebSocket 管理器、Docker
tests/              node --test（零依賴）：回測數學、風控邊界、策略契約、研究框架、proxy／串流整合
docs/               ARCHITECTURE.md（模組研究矩陣）、GOVERNANCE.md、UI_UX.md
scripts/            check-static.js、check-ui.js（35 閘門）、ui-score.js（/100 評分）、
                    check-syntax.js（跨平台語法檢查）、check-status.js（狀態同步閘）、
                    ci-summary.js（CI job summary）、smoke-*.js（真實資料煙霧測試）
tests/e2e/          Playwright 瀏覽器 E2E（只在 CI 安裝工具，不進 runtime）
```

> 測試數量與各閘門結果不寫在文件裡：由 CI job summary 自動產生（見 `docs/PROJECT_STATUS.md`）。

## 本機執行

### 搜尋其他台股代號

頂部搜尋可輸入 `0050`、`006208` 等代號，非內建標的會明確向 Fugle
查詢並開啟看盤，不需先切換資料模式。需使用已設定行情 proxy 的部署版本；
本機預設 `runtime-config.js` 未設定 proxy，會顯示 `PROXY_NOT_CONFIGURED`。
遠端標的只供看盤，不加入紙上下單清單；非內建股票名稱搜尋尚未支援。

```bash
# 1) 直接開檔（部分瀏覽器擋 file:// 的 ES module，建議用 2）
xdg-open index.html

# 2) 靜態伺服（推薦）
python3 -m http.server 8080
# 瀏覽 http://localhost:8080/

# 3) 跑測試（Node.js 24，零依賴）
npm test

# 4) 跑瀏覽器 E2E（需另外安裝 Playwright，只在 CI 會自動做）
npm install --no-save playwright@1.64.1 && npx playwright install chromium
npm run e2e
```

## 券商接線（留白，不實作真單）

- 台股：永豐 Shioaji（`simulation=True` 紙上模式，API Key／憑證走使用者本機 `shioaji server`，本專案不碰金鑰）
- 美股：Alpaca Paper（`https://paper-api.alpaca.markets`，paper key 只放使用者自己的 `.env`，不進 repo）

`js/paper.js` 的 `PaperBroker` 保持未來 broker adapter 的邊界（interface），切換時只換 adapter，不動 UI 與風控。

## 文件

- `docs/ARCHITECTURE.md` — 模組研究矩陣、架構邊界與取捨
- `docs/GOVERNANCE.md` — repo 治理、角色權限、風控規則、免責邊界
- `docs/UI_UX.md` — 設計代幣與頁面規格
- `docs/UI_UX_BENCHMARK.md` — 全球網頁設計／股票產品 benchmark、目前評分與 P0/P1/P2 改造路線
- `docs/DELIVERY_REPORT.md` — 交付、驗證、工時、成本與來源
- `docs/PROJECT_STATUS.md` — 唯一 current truth（scope／缺口／enforcement；HEAD／tests／gates 由 CI summary 產生）
- `docs/PROJECT_AUDIT.md` — baseline＋歷史快照 audit
- `docs/PROJECT_ROADMAP.md` — correctness-first 長程路線
- `docs/RISK_REGISTER.md` — P0/P1/P2 風險、證據與修復驗證
- `docs/RESEARCH_LEDGER.md` — 外部規則／設計／API claim 的來源索引
- `docs/FUTURE_PLAN.md` — 可照跑的收斂計劃書（Phase 步驟、驗收、證據、決策點）
- `DISCLAIMER.md` — 最高優先：教育用途、非投資建議、自負盈虧
