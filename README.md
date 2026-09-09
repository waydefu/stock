# 台美股自動交易網頁（TW/US Auto Trading Web）

繁體中文的台股＋美股分析與模擬自動交易單頁應用（SPA）。
純靜態、零依賴、免建置：直接用瀏覽器開 `index.html` 或走 GitHub Pages 即可跑。

> **定位**：研究／教育用原型（prototype），全部行情都是本機種子生成的模擬資料，
> 下單全部走紙上交易（paper trading），**不連真實券商、不給投資建議**。
> 詳見 `DISCLAIMER.md`。

## 功能（對應 50 家專家產品的綜合）

| 頁籤 | 學誰 | 做什麼 |
|---|---|---|
| 儀表板 | Koyfin／Finviz Matrix | 市場熱圖（市值加權方塊、漲跌著色）、大盤重點、自選報價 |
| 看盤 | TradingView／XQ／富果 | K 線圖＋MA5/20＋成交量、自選清單、盤勢資訊 |
| 選股 | Finviz／XQ／Tickers | 漲跌幅、量比、本益比、殖利率、RSI 多條件篩選 |
| 回測 | TradingView 策略測試器／TrendSpider | MA 交叉、RSI、突破三策略；手續費＋滑價預設非零；樣本數過少警告（學 TradingView 的坑） |
| 交易 | Alpaca／Shioaji 模擬單 | 紙上交易（台股 TWD 100 萬、美股 USD 10 萬分帳）、市價單、持倉損益 |
| 風控 | IB TWS／QuantConnect | 單筆上限、日損斷路器（kill switch）、下單二次確認、稽核日誌（audit log）可匯出 CSV |
| 治理 | Linear／Stripe 設計治理 | 角色（RBAC：觀察者／交易員／風控官／管理員）、深色 fintech 設計代幣（design tokens） |

## 架構

```
index.html          單頁殼＋七頁籤
css/styles.css      設計代幣＋元件（Kraken 式深色數據密度風）
js/data.js          種子隨機行情產生器（mulberry32，確定性、可重現）
js/charts.js        Canvas K 線／分時／權益曲線（無圖表庫依賴）
js/backtest.js      回測引擎（bar-close 評估、次根開盤成交、無未來函數）
js/paper.js         紙上交易帳本（localStorage 持久化）
js/risk.js          風控＋稽核日誌
js/app.js           UI 組裝＋角色治理
tests/              node --test（零依賴，測回測數學與風控邊界）
docs/               ARCHITECTURE.md（50 家綜合矩陣）、GOVERNANCE.md、UI_UX.md
```

## 本機執行

```bash
# 1) 直接開檔（部分瀏覽器擋 file:// 的 ES module，建議用 2）
xdg-open index.html

# 2) 靜態伺服（推薦）
python3 -m http.server 8080
# 瀏覽 http://localhost:8080/

# 3) 跑測試（node ≥ 20，零依賴）
node --test tests/
```

## 券商接線（留白，不實作真單）

- 台股：永豐 Shioaji（`simulation=True` 紙上模式，API Key／憑證走使用者本機 `shioaji server`，本專案不碰金鑰）
- 美股：Alpaca Paper（`https://paper-api.alpaca.markets`，paper key 只放使用者自己的 `.env`，不進 repo）

`js/paper.js` 的 `BrokerAdapter` 就是為這兩個留的轉接介面（interface），切換時只換 adapter，不動 UI 與風控。

## 文件

- `docs/ARCHITECTURE.md` — 50 家產品架構×治理綜合矩陣與取捨
- `docs/GOVERNANCE.md` — repo 治理、角色權限、風控規則、免責邊界
- `docs/UI_UX.md` — 設計代幣與頁面規格
- `DISCLAIMER.md` — 最高優先：教育用途、非投資建議、自負盈虧
