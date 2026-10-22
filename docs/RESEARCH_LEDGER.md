# Research Ledger

此表是 implementation 會依賴的外部規則／設計證據索引。[91][64][70] 完整 URL 與引用編號由 citation ledger 維護；本表只記「哪個 claim 影響哪個 implementation」。

| Claim | Source | Authority | Applies to | Time-sensitive | Implementation impact |
|---|---|---|---|---|---|
| 一般文字 AA 對比至少 4.5:1；focus／non-text 有獨立要求 | [91][92][93] | W3C WCAG 2.2 | UI tokens、focus、controls、charts | Stable standard，但版本需追 | 不接受只看色票；以 foreground/background pair 驗證 |
| layout 要適應視窗／文字尺寸／安全區；motion 要有目的且可減弱 | [64][65][66] | Apple HIG | responsive、typography、motion | Updated guidance | P0/P2 UI acceptance criteria |
| high-contrast colors、semantic scales、materials、grid、component states | [67][68][69] | Vercel Geist | design tokens、surfaces、grid | Product system may evolve | 用 semantic tokens 取代 inline values |
| contextual views、components、loading／empty／status patterns | [70][71][72] | Stripe Apps docs | workflow states、contextual research UI | Docs version-sensitive | 狀態元件與工作流邊界 |
| 降低 chrome 噪音、提升 hierarchy/density、漸進 rollout | [73][74] | Linear design posts | navigation、density、redesign rollout | Product-specific | 不用新增卡片解決 hierarchy；改成可驗證 rollout |
| data table toolbar、search、filter、sort、row actions、empty/error state | [79][80] | IBM Carbon | table system | Component guidance evolves | sticky header、sort、empty/error acceptance |
| focused／pressed／disabled states、transition／empty state semantics | [81][82][83] | Material Design | interaction states、motion | Version-sensitive | all controls need state matrix |
| chart／screener／paper／strategy tester／broker context in one workflow | [6] | TradingView official features | trading UX | Product version-sensitive | preserve selected-symbol context |
| dashboard and multi-asset market context | [86] | Koyfin official features | market overview | Data coverage changes | market-first dashboard |
| heatmap market breadth and visual market maps | [4] | Finviz official | heatmap／screener | Product feature changes | size/color must have data semantics |
| customizable multi-asset workspace, orders, risk, PaperTrader | [88] | IBKR official | order／risk workspace | Product/API version-sensitive | stateful execution view |
| desktop/web/mobile and paperMoney continuity | [89] | Schwab official | responsive / paper flow | Product version-sensitive | mobile is a workflow, not a shrunk desktop |
| API-first paper/live separation and simulator limitations | [36] | Alpaca official docs | broker boundary | Provider policy changes | paper-only adapter and explicit mode |
| Taiwanese quant flow and provider API boundary | [26][30] | XQ／Fugle official | TW research／adapter | Highly time-sensitive | verify rules, rate limits, corporate actions before integration |
| TWSE regular／odd-lot／price-limit baseline | [95][96][97] | TWSE official rules | MarketRules contract | Highly time-sensitive | regular unit、odd-lot limit/day rules、daily limit are sourced; exceptions remain explicit gaps。 |
|| TWSE tick size schedule (營業細則第62條) | [95][98] | TWSE official rules | MarketRules contract | Highly time-sensitive | 6 price bands with tick sizes 0.01/0.05/0.10/0.50/1.00/5.00 implemented as a single sourced snapshot; versioned effectiveFrom resolver deferred (no multi-version history claimed)。 |
|| TWSE daily price limit 10% with tick rounding (營業細則第63條) | [95][98] | TWSE official rules | MarketRules contract | Highly time-sensitive | Limit up rounded down, limit down rounded up to tick; example 40.60→up 44.65/down 36.55 verified。 |
|| TWSE trading sessions: pre-market call auction 08:30-09:00, continuous 09:00-13:25, pre-close call auction 13:25-13:30 | [95] | TWSE official rules | MarketRules contract | Stable | Order type restrictions per session enforced (limit only in call auctions)。 |
|| TWSE 2026-12-07 odd-lot regression: 盤中零股交易開盤時間提前至 09:00 | [98] | TWSE official news | MarketRules contract | Highly time-sensitive | SimplifiedWeekdayCalendar remains simplified; no session change in prototype。 |
| QuantConnect Algorithm Framework 五層分工（Universe／Alpha／Portfolio Construction／Execution／Risk Management、可互換模組） | [12]＋次級整理 [98][99] | Primary：QC official docs；Secondary：community guides（不得覆蓋 primary） | Strategy／Signal／Portfolio／Execution 分層設計 | Framework guidance evolves | 只取「分層＋可互換」工程概念；本 repo 不依賴其程式碼或 API；legacy 融合迴圈見 R-021。 |
| Provider capability／envelope／freshness／retry／transport 邊界契約 | [109][110][111][112][113][114][115][116][117][118] | Provider official docs（Fugle／Shioaji／Alpaca／IBKR） | MarketDataAdapter contract | Highly time-sensitive（verified 2026-09-11） | 官方未給數字的欄位標 UNVERIFIED 不猜；秘密永遠放 trusted proxy，Pages 不持 key。 |
| Fugle 行情 API v1.0：REST（日內／快照／歷史）＋WS 即時；交易 API 已 sunset | [109][30] | Fugle official docs | Provider readiness | Highly time-sensitive（verified 2026-09-11） | FIRST CANDIDATE（TW）；成交值量不含零股／鉅額；單帳號政策。 |
| Shioaji v1.7.5 simulation／限流語義 | [110][111][112] | Sinotrade official docs＋releases | Provider readiness | Highly time-sensitive（verified 2026-09-11） | sim 單禁興櫃／零股；超流回空值；憑證制→本機可信 process。 |
| Alpaca Market Data 與 Trading API 分離；Basic IEX／Plus SIP；paper 獨立 key | [113][114][115] | Alpaca official docs | Provider readiness | Highly time-sensitive（verified 2026-09-11） | US-only；429＋backoff 官方指引已收錄進 retry 契約。 |
| IBKR pacing／paper 限制／L1 訂閱制 | [116][117][118] | IBKR official docs | Provider readiness | Highly time-sensitive（verified 2026-09-11） | 重量級 deferred；最大 req/s＝lines÷2（100 lines→50/s）與 soft throttle 已收錄。 |
| Fugle REST 規格重查（7B1）：intraday quote／historical candles／錯誤碼／分級限流 | [119][120][121][122] | Fugle official docs | Fugle adapter | Highly time-sensitive（verified 2026-09-11） | 微秒戳 sourced conversion；區間<1年／404查無／429限流；日內 60-2000/min、歷史 60/min。 |
| Fugle REST 規格再驗（7B2）：candles 區間語義／錯誤碼／分級費率表 | [119][120][121][122] | Fugle official docs | Fugle adapter | Highly time-sensitive（verified 2026-09-11） | 區間<1日曆年（恰滿1年拒絕，官方例）；401 key無效／403方案不足／404查無 symbol；歷史一律 60/min。 |
| Volatility-managed portfolios：波動高時降險可提高 Sharpe；受限版本測試 leverage cap 1／1.5 | [100][101] | Primary：Journal of Finance＋NBER working paper | VolatilityTargetingOverlay（capped leverage） | Published research，stable | 低波動不變無限槓桿：maxLeverage 必須有限；本 repo 只做單標的 overlay，未做多因子。 |
| 時間序列動量／橫截面動量／價值動量／配對交易／data-snooping 的 canonical 引用（本輪未重讀全文，只記研究假說出處） | [102][103][104][105][106][107][108] | Journals（JFE／JF／RFS／Econometrica）＋AQR 白皮書 | multi-horizon trend hypothesis；pairs／regime／White 檢驗留待後續 | Canonical references，需實作前重查 | 多 horizon 組合只為穩健高原，不宣稱機構級；pairs／regime 未達資料門檻不實作。 |
| GitHub Actions secure use：least privilege、secret handling、workflow security | [94] | GitHub official secure-use reference | CI／supply chain | Security guidance evolves | permissions read-only；action refs immutable；Dependabot 更新 pinned refs。 |
| TWSE 股票價格升降單位分六段（未滿 10 元 0.01／10–未滿 50 元 0.05／50–未滿 100 元 0.10／100–未滿 500 元 0.50／500–未滿 1000 元 1.00／1000 元以上 5.00） | [125] | 臺灣證券交易所營業細則第62條 | MarketRules 商品別 tick 表 | Highly time-sensitive（查閱 2026-10-22） | 實作為股票表 `TW_STOCK_TICK_SCHEDULE`；`getTickSize("TW", price)` 預設即此表，既有呼叫端行為不變。 |
| ETF／主動式 ETF／REITs 每受益權單位未滿 50 元升降單位 0.01、50 元以上 0.05；封閉型基金準用上市股票表 | [126] | 臺灣證券交易所受益憑證買賣辦法第7條 | MarketRules 商品別 tick 表 | Highly time-sensitive（查閱 2026-10-22） | 實作為 `TW_ETF_TICK_SCHEDULE`（0.01／0.05）；商品別 etf／etn／reit 走此表，closedfund 走股票表。 |
| 集中市場升降單位總表：認購(售)權證與認股權憑證 0–5:0.01、5–10:0.05、10–50:0.10、50–100:0.50、100–500:1.00、500 以上:5.00 | [98] | 臺灣證券交易所「集中市場交易制度介紹／壹、升降單位」 | MarketRules 商品別 tick 表 | Highly time-sensitive（查閱 2026-10-22） | 實作為 `TW_WARRANT_TICK_SCHEDULE`；權證在 5–10 元已是 0.05，與股票表不同，不可混用。 |
| 每日漲跌停＝開盤競價基準×110%／×90% 再依升降單位對齊（漲停取不超過上限之最大合法值、跌停取不低於下限之最小合法值；官方範例 40.60→漲停 44.65／跌停 36.55） | [98] | 臺灣證券交易所「集中市場交易制度介紹／壹、每日有價證券漲跌停價格計算範例」 | MarketRules 漲跌停計算 | Highly time-sensitive（查閱 2026-10-22） | `calculatePriceLimits()` 改以整數最小單位運算並採 floor／ceil，取代浮點 `Math.floor/Math.ceil`；300,000 檔窮舉 0 mismatch。 |
| 股票每日市價升降幅度以開盤競價基準 10% 為限；升降幅度限度未滿最小升降單位者按最小升降單位計算 | [97] | 臺灣證券交易所營業細則第63條 | MarketRules 漲跌幅 | Highly time-sensitive（查閱 2026-10-22） | `dailyPriceLimitPct = 10` 維持；「低位價下限以最小升降單位為限」尚未建模（明確缺口）。 |
| 零股交易買賣申報應以限價為之，且限當日有效 | [96] | 臺灣證券交易所上市股票零股交易辦法第3條 | MarketRules 零股委託限制 | Highly time-sensitive（查閱 2026-10-22） | `validateOrderTypeInSession(market, orderType, ts, lot)` 於 TW＋oddLot＋非限價單回 `ODD_LOT_LIMIT_ONLY`；risk 層傳 lot 原文。 |
| 盤中零股交易委託以限價為之且限當日有效（申報 9:00–13:30、9:10 起每 5 秒集合競價） | [98] | 臺灣證券交易所「集中市場交易制度介紹／肆、盤中零股交易」 | MarketRules 零股制度 | Highly time-sensitive（查閱 2026-10-22） | 零股限價規則已實作；零股專屬申報時段與集合競價制度尚未建模（明確缺口）。 |
| 受益憑證每日升降幅度準用上市股票（10%），但國外成分 ETF／期貨信託 ETF／境外指數股票型基金／國外成分主動式 ETF 無升降幅度限制；槓桿反向 ETF 為 10%×倍數 | [126] | 臺灣證券交易所受益憑證買賣辦法第8條 | MarketRules 漲跌幅 | Highly time-sensitive（查閱 2026-10-22） | **尚未實作**：`dailyPriceLimitPct` 目前一律 10%（明確缺口，需商品別每日升降幅度資料模型）。 |
| 權證漲跌停非 ±10%，以標的證券當日漲跌停價換算；指數型權證以前一日標的指數收盤×每點對應金額×行使比例×10% 計算 | [98] | 臺灣證券交易所「集中市場交易制度介紹／壹、每日升降幅度」 | MarketRules 漲跌停 | Highly time-sensitive（查閱 2026-10-22） | **尚未實作**：權證只支援 tick 表，漲跌停仍走一般 ±10% 公式（明確缺口，需標的證券漲跌停價）。 |
## Evidence policy

- Government／exchange／regulator > official broker/API docs > official design system > primary repo > secondary comparison。
- 金融規則、API limits、paper/live semantics 每次 implementation 前重新查官方頁。
- Benchmark claim 不等於本 repo requirement；落地前要建立 local test／browser evidence。
- 沒有來源或只看到搜尋片段的 claim，標成 Needs verification，不當成 invariant。

## Current unverified external work

- TWSE 商品別「每日升降幅度」規則（受益憑證買賣辦法第8條：無升降幅度 ETF、槓桿反向 ETF 倍數）尚未建模；權證漲跌停換算公式、上櫃（TPEx）規則、債券 tick 表亦未建模（見 FUTURE_PLAN Track B2 缺口 G-1～G-4）。
- 盤中／盤後零股專屬申報時段與集合競價制度尚未建模（G-5）；新上市首五日無漲跌幅限制未建模（G-7）。
- Fugle／Shioaji／Alpaca／IBKR 當前 adapter limits 與 paper 行為。
- GitHub Actions secret scanning、code scanning、dependency review policy（immutable SHA pin＋Dependabot 已於 v7 落地並綠燈）。
- AQR 白皮書 URL（[103]／[107]）為記憶重建、本輪未能開啟驗證；任何實作引用前必須重查官方頁，不得直接採用。
- Fugle WebSocket（[123]／[124]）已於 2026-09-11 以真瀏覽器實讀驗證：
  upstream `wss://api.fugle.tw/marketdata/v1.0/stock/streaming`、連線後送 `{event:"auth"}`
  認證、30s heartbeat、subscribe→subscribed（含 server id）、trades data 含 number 型
  `time`／`serial`／`isTrial`；頁面標示 Last updated Jan 9, 2026。Phase 7C contract 以此為準。

## Sources

[4] https://finviz.com/blog/the-finviz-matrix-market-breadth-visualized
[6] https://www.tradingview.com/features
[26] https://www.xq.com.tw
[30] https://developer.fugle.tw/docs/trading/intro
[36] https://docs.alpaca.markets/us/docs/paper-trading
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
[79] https://carbondesignsystem.com/components/data-table/usage
[80] https://preview.carbondesignsystem.com/building-blocks/core/patterns/empty-states
[81] https://m3.material.io/foundations/interaction/states/applying-states
[82] https://m1.material.io/patterns/empty-states.html
[83] https://m3.material.io/styles/motion/transitions/applying-transitions
[86] https://www.koyfin.com/features/market-dashboards
[88] https://www.interactivebrokers.ca/en/trading/tws.php
[89] https://www.schwab.com/trading/thinkorswim
[91] https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum
[92] https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
[93] https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance
[94] https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
[95] https://www.twse.com.tw/en/products/system/trading.html
[96] https://twse-regulation.twse.com.tw/ENG/EN/law/DAT0201.aspx?FLCODE=FL007115
[97] https://twse-regulation.twse.com.tw/ENG/EN/law/DOC01.aspx?FLCODE=FL007304&FLNO=63
[98] https://www.twse.com.tw/zh/products/system/trading.html
[99] https://www.quantconnect.com/docs/v2/writing-algorithms/algorithm-framework
[100] https://alphanova.tech/blog/quantconnect-lean-algorithmic-trading-engine
[101] https://doi.org/10.1111/jofi.12513
[102] https://www.nber.org/papers/w22208
[103] https://doi.org/10.1016/j.jfineco.2011.11.006
[104] https://doi.org/10.1111/j.1540-6261.1993.tb04702.x
[105] https://doi.org/10.1093/rfs/hhj020
[106] https://doi.org/10.1111/1468-0262.00152
[107] https://www.aqr.com/Insights/Research/White-Papers/A-Century-of-Evidence-on-Trend-Following-Investing
[108] https://www.aqr.com/Insights/Research/Journal-Article/Value-and-Momentum-Everywhere
[109] https://developer.fugle.tw/docs/data/intro
[110] https://sinotrade.github.io/tutor/simulation
[111] https://github.com/Sinotrade/Shioaji/releases/tag/v1.7.5
[112] https://github.com/Sinotrade/Shioaji/blob/master/plugins/shioaji/skills/shioaji/references/TROUBLESHOOTING.md
[113] https://docs.alpaca.markets/us/docs/about-market-data-api
[114] https://docs.alpaca.markets/us/docs/paper-trading
[115] https://docs.alpaca.markets/docs/market-data-faq
[116] https://www.interactivebrokers.com/docs/tws-api/doc/pacing-limitations/introduction
[117] https://www.interactivebrokers.com/campus/glossary-terms/paper-trading-account/
[118] https://www.interactivebrokers.com/docs/general/market-data-subscriptions/introduction
[119] https://developer.fugle.tw/docs/data/http-api/intraday/quote
[120] https://developer.fugle.tw/docs/data/http-api/historical/candles
[121] https://developer.fugle.tw/docs/data/error_codes
[122] https://developer.fugle.tw/docs/pricing
[123] https://developer.fugle.tw/docs/data/websocket-api/getting-started
[124] https://developer.fugle.tw/docs/data/websocket-api/market-data-channels/trades
[125] https://twse-regulation.twse.com.tw/TW/law/DOC01.aspx?FLCODE=FL007304&FLNO=62
[126] https://twse-regulation.twse.com.tw/TW/law/DAT0201.aspx?FLCODE=FL007114
