# UI/UX Design System

## 主要表面（surface）

這不是行銷首頁，而是以 **Monitor（監看）為主、Operate（操作）為次、Explore（探索）為輔** 的交易研究工作台。[4][1][9][44] 資訊密度服務於判斷，不用 hero＋三張等權卡片取代工作流。

## 設計決策

| 領域 | 採用的頂級模式 | 落地規則 | 不採用 |
|---|---|---|---|
| 視覺市場掃描 | Finviz Matrix 以大小／顏色組織市場廣度；Koyfin 用可自訂 dashboard 組合市場資料。[4][1] | 熱圖每一格同時顯示代號、變化；顏色只做輔助，表格保留數值 | 彩色裝飾沒有數據意義 |
| 工作區 | TradingView Desktop 的 synced workspace；thinkorswim 的分頁工作模型。[9][44] | 頁籤固定工作語意：儀表板、看盤、選股、回測、紙上交易、風控／稽核 | 把所有功能塞在一張無法掃讀的畫面 |
| 圖表 | TradingView 的多時間框架／指標／策略測試；TC2000 的圖表與 watchlist 連動。[6][7][8][16] | 圖表旁放清楚的技術讀數與資料假設；selected symbol 可回到同一頁 | 只畫漂亮線，不告訴使用者資料與成交假設 |
| 選股 | Koyfin 的條件與 watchlist；Stock Rover 的比較表；XQ 的中文量化入口。[3][18][19][26] | 先少量篩選欄位，結果可點回圖表；標籤只描述資料，不輸出「買進」 | 無限欄位、假精準評分、把條件直接連到下單 |
| 回測 | TradingView 的 properties／trade list；TrendSpider 的 test → deploy 連續性。[7][8][10] | 回測頁固定顯示成本、滑價、樣本、成交時點、交易明細、回撤 | 只顯示淨利和勝率；沒有成本的綠色曲線 |
| 訂單 | Alpaca／IBKR 的 paper、order status、order type 與 precautionary settings。[36][38][39][41][42] | 下單前顯示模式、名目金額、風控決策；再開二次確認；成交後寫回歷史 | 一鍵直送、危險按鈕與研究按鈕同權重 |
| 治理 | cTrader plugin 的明確 trading permission；XQ 的策略完整執行紀錄。[50][27] | 角色、權限、斷路器、理由、audit CSV 都可見；前端角色只做展示 | 隱藏權限、靜默 fallback、可刪改稽核紀錄 |
| 台股 | Fugle 的 candles／速率限制／corporate actions；CMoney 的標準化資料定位。[31][32][33][29] | 顯示資料狀態與來源責任；預留除權息與限流訊息 | 把台股特殊規則當成美股欄位換代號 |

## 代幣與元件

- 背景：`#0d0e13`；surface：`#14161d`／`#1b1e27`；邊界：`#262b3a`。
- 品牌紫只做選取／主動操作；漲跌使用綠／紅加文字百分比，不靠顏色單獨傳達。
- 數值使用等寬字與 tabular figures，方便垂直比較。
- 觸控／窄螢幕仍要能點到核心動作；focus state 不可被深色主題吃掉。
- 所有資料頁要有空狀態、錯誤狀態、模擬／來源狀態；不顯示未標示來源的「即時」字樣。
- 動效只用於狀態變更；支援 `prefers-reduced-motion`。

## 品質檢查

- **Scan test**：5 秒內找得到市場、標的、變化、資料模式。
- **Action test**：下單前看得到方向、數量、價格、名目金額、風控理由與 paper 標誌。
- **Evidence test**：回測結果旁看得到成本、滑價、成交模型、交易數與回撤。
- **Recovery test**：權限不足、資料不存在、風控拒絕、紙上現金不足時，頁面說明下一步，不靜默改單。
- **Responsive test**：窄視窗先保留狀態、主操作與風控；次要欄位可水平滾動，不縮成不可讀的數字。

## 響應式降級規則（breakpoints：1279／1100／800／480）

| 寬度 | 版面 | 降級順序（先降級的不影響交易語義） |
|---|---|---|
| ＞1279 | 完整：work-grid dominant＋側欄、四欄 KPI | 無降級 |
| ≤1279 | work-grid 疊成單欄；側欄（來源／穩健）移到主欄下方 | 側欄位置 |
| ≤1100 | c4→兩欄；c3→單欄 | KPI／market breadth 欄數 |
| ≤800 | c2／c4→單欄；表格走 `.overflow-table` 水平滾動，不擠壓數字欄 | 次要欄水平滾動（數字欄保持 tabular-nums 可讀） |
| ≤480 | main padding 縮小；cmdbar 輸入縮至 120px；頂欄維持市場切換＋角色＋PAPER 標示 | chrome 留白，保留狀態列與主操作 |

鐵律：任何寬度下單票（標的／方向／數量／價格／風控／二次確認）與 PAPER 標示不得消失；表格數字欄不得換行擠壓，寧可水平滾動。

## Sources

[1] https://www.koyfin.com/features
[3] https://www.koyfin.com/features/stock-screener
[4] https://finviz.com/blog/the-finviz-matrix-market-breadth-visualized
[6] https://www.tradingview.com/features
[7] https://www.tradingview.com/support/solutions/43000628599-strategy-properties
[8] https://www.tradingview.com/pine-script-docs/concepts/strategies
[9] https://www.tradingview.com/desktop
[10] https://trendspider.com/product/strategy-development-and-backtesting-tools
[16] https://www.tc2000.com/features/overview
[18] https://www.stockrover.com/stock-charting
[19] https://www.stockrover.com/stock-rovers-top-5-features-transcript
[26] https://www.xq.com.tw
[27] https://www.xq.com.tw/xsat
[29] http://app.cmoney.tw
[31] https://developer.fugle.tw/docs/data/http-api/getting-started
[32] https://developer.fugle.tw/docs/data/websocket-api/market-data-channels/candles
[33] https://developer.fugle.tw/docs/data/http-api/corporate-actions/capital-changes
[36] https://docs.alpaca.markets/us/docs/paper-trading
[38] https://alpaca.markets/learn/start-paper-trading
[39] https://www.interactivebrokers.com/en/trading/tws.php
[41] https://interactivebrokers.github.io/tws-api/third_party.html
[42] https://interactivebrokers.github.io/tws-api/basic_orders.html
[44] https://welcome.schwab.com/content/introduction-to-thinkorswim-desktop-platform
[50] https://help.ctrader.com/ctrader-algo/documentation/plugins
