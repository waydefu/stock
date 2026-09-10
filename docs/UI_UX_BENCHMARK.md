# UI/UX Benchmark Report

## 結論先行

本報告不是宣稱存在一份客觀的「全球前十排名」。我選的是有公開官方設計規範、產品文件或成熟交易流程的 10 個網頁設計基準與 10 個股票研究／交易基準，拿它們的具體優點對照目前 repo 的實作。

**目前網站評分：2.0 / 10。**（歷史基線；workstation round 增補見文末「Workstation round（PR#9）」，原 rubric 不重算、不洗分。）

這個分數不是因為深色主題本身不好，而是因為目前有三個結構性問題：

1. 設計 tokens 被 55 個 inline `style` 屬性繞過。
2. 資訊層級、表格狀態、空狀態與警告優先級不足。
3. 質感與動效幾乎沒有：CSS 只有 reduced-motion 規則，沒有一般 transition、animation 或 box-shadow。

安全與工程底座反而高於視覺品質：paper-only、風控、稽核、回測測試與 CI 都已存在，所以分數沒有低到 0 分。

## 研究方法

比較維度固定為：

- Design system integrity：元件是否真的共用 tokens、元件與狀態是否一致。
- Visual hierarchy：主數字、標籤、警告、次要資訊是否一眼分出優先級。
- Surface/material quality：材質、邊界、陰影、色彩與間距是否形成一致空間語言。
- Motion quality：動效是否表達狀態與因果、是否短而精準、是否支援 reduced motion。
- Data-dense UX：圖表、表格、篩選、工作區是否讓使用者快速掃描與深入。
- States：loading、empty、error、permission denied、success、disabled 是否完整。
- Trading safety：paper/live 邊界、訂單狀態、事前風控、確認與稽核是否清楚。
- Responsive/accessibility：窄視窗、鍵盤、focus、文字放大、對比與表格可讀性。

## 全球 10 個網頁設計／設計系統基準

| # | 基準 | 已研究的強項 | 對本專案的要求 |
|---:|---|---|---|
| 1 | Apple HIG | 版面要適應視窗、裝置、文字尺寸與安全區；動效要有目的、短、可選且不能成為唯一訊息。[64][65][66] | responsive 不是只加一個 breakpoint；要測文字放大、focus、窄版與 reduced motion。 |
| 2 | Vercel Geist | 明確的高對比色階、文字／圖示語義、材料、grid、button/input/modal 狀態。[67][68][69] | 建立 semantic tokens；不能讓每個頁面自己發明灰色、紫色與間距。 |
| 3 | Stripe Apps | 用 view root、contextual surface、元件與 patterns 組合；官方 patterns 另外定義 loading、empty、status、onboarding。[70][71][72] | 研究工具要跟著工作上下文出現；空狀態與載入狀態要是產品流程，不是空白。 |
| 4 | Linear | 在高密度產品中降低 header、sidebar、tabs、panels 的視覺噪音，讓目前視圖與可用動作更清楚；重設計先用 feature flag 漸進驗證。[73][74] | 不靠更多卡片解決層級問題；先收斂 chrome、對齊與操作焦點。 |
| 5 | Framer | Design Pages、components、styles、stacks／grids、responsive breakpoints、prototype 到 publish 在同一流程。[75] | 元件變更要能全域同步；不要把同一種文字與 spacing 寫 55 次。 |
| 6 | GitHub Primer | foundations、tokens、components、accessibility、Figma library 與程式碼對應，並以 code 作為 source of truth。[76][77] | CSS token、HTML class、文件規則要互相對得上；設計系統要能被 CI 檢查。 |
| 7 | Figma Variables／SDS | variables 可表達 color、number、string、boolean、timing、easing，並可切換 modes 與同步到 code。[78] | motion、spacing、color 不只做 CSS 常數；需要語義命名與可替換狀態。 |
| 8 | IBM Carbon | Data table 具備 toolbar、search、filter、sort、row action、expand、pagination；empty state 依 no-data、user-action、error-management 分類。[79][80] | 表格必須有 sticky header、排序／篩選入口與可行動的空狀態。 |
| 9 | Material 3 | disabled、focused、pressed 等狀態有明確語義；empty state 避免完全空白；transition 應服從狀態變更而不是裝飾。[81][82][83] | 每個 control 要有 default／hover／focus／pressed／disabled／error，不只 default。 |
| 10 | Notion Components | 用 text、headers、toggle、database、table、board、calendar、gallery 等可組合 blocks 支援不同工作流。[84] | 頁面應由可組合的工作區元件構成，不要所有頁面都套相同四卡片模板。 |

補充參考：Airbnb Design 作為品牌／內容編排參考，但本次不把它的行銷視覺直接移植到交易終端。[85]

## 股票研究／交易 10 個基準

| # | 產品 | 已研究的強項 | 對本專案的要求 |
|---:|---|---|---|
| 1 | TradingView | chart、screener、heatmap、alerts、Pine Script、strategy tester、paper trading 與 broker integration 形成連續工作流。[6] | 圖表不能是孤立圖片；研究、策略、警示、paper 狀態要能互相回到同一標的上下文。 |
| 2 | Koyfin | market dashboards 把全球指數、利率、貨幣、商品、產業與宏觀資料集中到可掃描畫面。[86] | 儀表板先給市場 context，再讓使用者鑽入單股。 |
| 3 | Finviz | Matrix／heatmap 以大小與顏色呈現市場廣度，支援不同市場 map 與 responsive layout。[4] | 色彩必須有資料語義，不能只做品牌裝飾；熱圖要與表格／標的詳情連動。 |
| 4 | Stock Rover | 表格比較、screening、長期基本面、portfolio analytics 與 research report 串在一起。[87] | 選股結果不能停在候選清單，要能保留條件、比較、回到研究報告。 |
| 5 | Interactive Brokers TWS | Mosaic 可自訂工作區，整合行情、圖表、訂單、portfolio、100+ order types、risk 與 PaperTrader。[88] | 交易面需要可組合 workspace、訂單狀態、風險視角，而不是只有買／賣按鈕。 |
| 6 | thinkorswim | desktop／web／mobile 分層，提供 chart、scan、paperMoney、research 與跨裝置連續性。[89] | 窄版不是把桌面畫面縮小；要保留核心流程、把次要欄位降級。 |
| 7 | Alpaca | API-first、paper account 與 live account 分離；paper API 規格接近 live，但明確說明模擬限制。[36] | paper 標籤、模式、API boundary 必須一直可見，不能讓使用者誤以為已接真券商。 |
| 8 | Webull | desktop／web／mobile 同一產品家族，支援 customizable layouts、order flow、chart trading、paper trading 與風險監控。[90] | 可自訂不是無秩序；要有預設 layout、狀態同步與高頻操作回饋。 |
| 9 | TradeStation | EasyLanguage、API、策略開發、模擬與執行路徑連結，適合研究到執行的系統化流程。[45] | 回測參數與實際執行設定要共用語義，避免邏輯漂移。 |
| 10 | 台股量化 lane：XQ + Fugle | XQ 把選股、回測、模擬、策略執行與紀錄串起來；Fugle 提供行情／交易 API 與台股資料特殊欄位。[26][30] | 台股不能只換 ticker；要處理 rate limit、corporate actions、券商規則與資料來源狀態。 |

## 目前網站的證據盤點

### 已確認的結構問題

- `index.html` 有 **55 個 inline `style` 屬性**。
- 其中 `color:var(--muted)` 出現 **18 次**。
- `font-size:12px` 出現 **16 次**。
- `margin-top:12px` 出現 **11 次**。
- CSS 有 `transition` 只有 reduced-motion 例外，`animation` **0**，`@keyframes` **0**，`box-shadow` **0**。
- `canvas.chart` 只有 `width:100%`，沒有 CSS 固定高度；高度靠 JavaScript 執行後才寫入。
- 表格 `thead` 沒有 sticky；初始 HTML 的 `tbody` 是空的，JavaScript 沒有成功載入時沒有可行動的空狀態。
- 同一個 paper／模擬限制分散在 dashboard、backtest、trade notice 與 footer，優先級不夠集中。

### 色彩計算

以 repo 目前值計算：

- `#ffffff` on `#855bfb`：**4.30:1**，低於 WCAG AA 一般文字的 4.5:1。[91]
- `#ffffff` on `#5b1ecf`：**8.30:1**，可作為主按鈕背景。
- `#a78bfa` on `#855bfb`：**1.58:1**，不能把亮紫直接放到原紫色背景上當修復。

重點是要評估「前景／背景配對」，不是單看某個色票亮不亮。WCAG 同時要求 focus／非文字控制具有足夠可辨識度。[91][92][93]

## 現況評分：2.0 / 10

評分是依本報告的加權模型，不是主觀喊價：

| 維度 | 權重 | 目前分數 | 根據 |
|---|---:|---:|---|
| Design system integrity | 15% | 1/10 | 55 個 inline styles 架空 tokens。 |
| Visual hierarchy | 15% | 2/10 | 13px 灰標題、22px KPI、12px 副標的差距不夠；主數字沒有穩定的語義 badge。 |
| Surface／material quality | 15% | 1/10 | 沒有 shadow／elevation／material 層次；卡片主要靠同色背景與邊框分隔。 |
| Motion／interaction polish | 15% | 0/10 | 沒有一般 transition／animation／state transition；只有 reduced-motion 規則。Apple 將動效定位為狀態與回饋工具，而非裝飾。[65] |
| Trading workflow | 15% | 3/10 | 頁籤、回測、paper order、風控流程存在，但圖表／表格／訂單上下文仍是薄原型。 |
| Tables／states | 10% | 1/10 | 沒 sticky header、排序狀態、載入狀態與明確 empty／error state。Carbon 與 Stripe 都把這些當正式 patterns。[79][80][72] |
| Accessibility／responsive | 10% | 3/10 | 有基本 focus-visible 與 breakpoint，但對比、表格語義、窄版欄位與文字放大尚未完成。 |
| Safety／governance | 5% | 6/10 | paper-only、風控、稽核、權限意識比視覺層成熟。 |

加權結果：**2.0 / 10**。所以你給 2/10 是合理基準，不是過度嚴格。

## 改造順序

### P0：先恢復設計系統與視覺層級

1. 清掉 55 個 inline styles，改為 utilities／semantic classes：
   - `.muted`
   - `.faint`
   - `.fs-12`
   - `.title-page`
   - `.mt-3`
   - `.stack`
   - `.overflow-table`
2. 建立真正的 type scale：
   - page title
   - section title
   - KPI 28px+
   - numeric value
   - label／meta
3. 品牌紫改成配對式 semantic tokens：
   - dark button background：`#5b1ecf`
   - light purple text／selected state：另設可測對比的 token
   - 不使用 `#a78bfa` on `#855bfb`
4. 每張 KPI 卡改成：label → 28px 主數字 → 語義變化 badge → 解釋文字。
5. 紙上／模擬限制只保留一條全域狀態列；真正的風控警告獨立升級，不再和一般免責混在一起。

### P1：補資料產品的完整狀態

1. `canvas.chart` 補 CSS aspect-ratio／min-height，JS 只負責繪圖，不負責拯救塌陷布局。
2. canvas 加：價格軸、格線、最後成交價虛線、hover crosshair、legend 狀態。
3. table 加 sticky `thead`、sort state、focus row、responsive overflow。
4. 每個資料容器補三種明確狀態：
   - loading：正在取得資料
   - empty：目前沒有資料＋下一步
   - error／permission：原因＋可採取的動作
5. 按 Stripe／Carbon 的模式，將「狀態」當成元件，不再讓 JS 失敗後留下空白 tbody。[72][79][80]

### P2：做出質感與動效

1. 建立 motion tokens：fast、base、emphasis、reduced；transition 只用在 hover、focus、tab、modal、success／error state。
2. 頁籤切換使用短暫 opacity／translate 過渡；不讓整張資料表逐列飛入。
3. KPI 更新用數值變化／flash indicator 表達變更，但不能閃爍到妨礙讀取。
4. order preview → confirmation → filled 使用同一條可追蹤的狀態過渡。
5. Card elevation 只用在真正有層級的 surface：modal、tooltip、active panel；不給每張卡片無意義陰影。
6. 所有動效在 `prefers-reduced-motion: reduce` 下改為立即切換。
7. 頂欄重排：市場 segmented control 保留，角色收進 account／command menu；避免頂欄同時塞品牌、行情、角色與帳號狀態。

## 研究後的判斷

目前網站不是「深色主題做錯」，而是「還沒有完成設計系統」。

真正要學的是：

- Apple：適應、字級與有目的的 motion。[64][65][66]
- Vercel／Primer／Figma：tokens 要能落到元件與 code，不是只存在 CSS 檔。[67][68][76][77][78]
- Stripe／Carbon／Material：patterns、states、tables、empty/error 要是一等公民。[70][71][72][79][80][81][82]
- Linear／Framer：在高密度工作流中保持清晰、可組合、可漸進迭代。[73][74][75]
- TradingView／Koyfin／Finviz／IBKR：資訊密度要服務決策，而不是把數據塞滿畫面。[6][86][4][88]

因此，下一版不應先換主色；應先建立 token → component → state → motion 的完整鏈路，再重新評分。

## Sources

[4] https://finviz.com/blog/the-finviz-matrix-market-breadth-visualized
[6] https://www.tradingview.com/features
[26] https://www.xq.com.tw
[30] https://developer.fugle.tw/docs/trading/intro
[36] https://docs.alpaca.markets/us/docs/paper-trading
[45] https://developer.tradestation.com
[64] https://developer.apple.com/design/human-interface-guidelines/layout
[65] https://developer.apple.com/design/human-interface-guidelines/motion
[66] https://developer.apple.com/design/human-interface-guidelines/accessibility
[67] https://vercel.com/geist/introduction
[68] https://vercel.com/geist/colors
[69] https://vercel.com/geist/grid
[70] https://docs.stripe.com/stripe-apps/design
[71] https://docs.stripe.com/stripe-apps/components
[72] https://docs.stripe.com/stripe-apps/patterns
[73] https://linear.app/now/behind-the-latest-design-refresh
[74] https://linear.app/changelog/2024-03-20-new-linear-ui
[75] https://www.framer.com/features/design
[76] https://primer.style
[77] http://primer.style/product/getting-started/figma
[78] https://help.figma.com/hc/en-us/articles/15339657135383-Guide-to-variables-in-Figma
[79] https://carbondesignsystem.com/components/data-table/usage
[80] https://preview.carbondesignsystem.com/building-blocks/core/patterns/empty-states
[81] https://m3.material.io/foundations/interaction/states/applying-states
[82] https://m1.material.io/patterns/empty-states.html
[83] https://m3.material.io/styles/motion/transitions/applying-transitions
[84] https://www.notion.so/Notion-Components-90471116c41744ab873fa4b694cee24f
[85] https://airbnb.design
[86] https://www.koyfin.com/features/market-dashboards
[87] https://stockrover.com/compare
[88] https://www.interactivebrokers.ca/en/trading/tws.php
[89] https://www.schwab.com/trading/thinkorswim
[90] https://www.webull.com/trading-platforms
[91] https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum
[92] https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
[93] https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance

## Workstation round（PR#9，`604fbba`）增補

原 2.0/10 rubric 不重算（重算需要瀏覽器截圖＋人工 rubric，而本機 Chromium 正處於 R-020 環境限制）。本輪改用量測型分數：`npm run score:ui` **100/100 PASS**（8 維度、每分附 evidence；release gate ≥85 且零 hard-gate failure）。

結構性變化（對照 rubric 維度）：

- Design system integrity：inline style 0；spacing scale 4–32（2 處 waiver 附理由＋複審）；radius 上限 8px；無功能漸層／結構模糊。
- Visual hierarchy：回測首屏改為權益曲線（含 IS／OOS 分界）優先，metrics 退後；策略中心採 dominant＋側欄 work-grid。
- Data-dense UX：compact 列高（th 6px≈32px 列）、tabular-nums、sticky th、全表 contained scroll；標的搜尋＋快速鍵（/ 1–6 B S ?）。
- States：策略表初始非空白、無 OOS 資料錯誤態、零交易 N/A、gate FAIL 明示。
- Trading safety：PAPER 常駐頂欄＋下單票＋確認窗＋流程＋頁尾（5 處靜態）；整零股選擇＋預估手續費；確認窗「回去修改」。
- Responsive/accessibility：1279／480 斷點、鍵盤可達 tiles（role＋tabindex＋Enter／Space）、dialog focus trap 擴及說明窗；check-ui 21/21。

仍缺（誠實）：4 viewport 截圖、瀏覽器幾何閘（重疊／裁切／橫向捲動實測）、完整 WCAG 人工 audit——待 R-020 環境修復。
