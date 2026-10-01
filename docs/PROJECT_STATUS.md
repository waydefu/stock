# Project Status（唯一 current truth）

> 本文件是唯一「現在狀態」來源。歷史快照見 `docs/PROJECT_AUDIT.md`
> （baseline＋歷史，不再設 Current checkpoint）。
> Authority hierarchy：Runtime＋tests ＞ main HEAD ＞ ADR ＞ RISK_REGISTER ＞
> RESEARCH_LEDGER ＞ PROJECT_ROADMAP ＞ PROJECT_AUDIT（歷史）。

## Current（分支驗證；main HEAD 以 GitHub 為準，合併後以 merge commit 更新）

- Last verified main checkpoint：`70bcf79`（PR#33／#34 與 Pages Actions 更新已合併）
- 本分支：`fix/remote-search-mode`（修正 #34 殘留的 FUGLE_MODE_OFF：預設模擬模式可明確搜尋 0050／006208，報價與歷史 K 線直接進看盤；下單清單仍限內建模擬標的）
- Tests：287/287 pass、fail 0、cancelled 0（Node 24.19.0）；`check:static` 27 files；`check:ui` 34/34 WARN 0 FAIL 0
- Quality：以 GitHub required check「Quality」為準（含 Check status sync gate）；禁止在 version-controlled truth 內追逐自身 run ID
- 前輪 PR：#29 已關閉；#30–#34 已合併。本分支以新 PR 提交。
- Benchmark：UI 7.9/10（舊 2.0 保留，見 `UI_UX_BENCHMARK.md`）；`score:ui` 100/100 為靜態原始碼證據，不代表使用者流程可用（R-032）
- Phase 7B／7C：#20–#28 全部 MERGED；`realtimeStream=true`；browser SSE client＋最小 Live UI 已上 main
- Audit：2026-09-14 snapshot 見 `docs/PROJECT_AUDIT.md`；修正計畫見 `docs/FUTURE_PLAN.md`「稽核後收斂 Track A–D」
- 搜尋驗證（2026-10-01）：正式 proxy 的 0050 quote／bars HTTP 200；Chromium 本機以擷取的真實 envelope 回放，修正前 FUGLE_MODE_OFF 且零請求，修正後進看盤、報價＋K 線皆請求、資料模式仍 simulation、PAPER 下單清單未增加 0050、無 page error。線上版待本 PR 合併與 Pages 部署。
- **Next executable**：合併搜尋修正後接 Track A2（proxy／串流防濫用）。
- Real-data runtime：Render `https://stock-fugle-proxy.onrender.com`；REMOTE_QUOTE_SMOKE=PASS；REAL_HISTORY=PASS；REAL_RESEARCH_SMOKE=PASS（promotion=FAIL，僅研究 gate）；Pages 已注入 proxy URL；
   串流（2026-09-13）：REAL_STREAM_TRANSPORT=PASS；REAL_STREAM_TRADE=BLOCKED_BY_MARKET_CLOSED；5-min soak 見 R-022

## Scope

paper／research-only prototype；無 live broker path；公開 Pages 不持任何憑證。

## Known gaps

### Blockers（2026-09-14 稽核，Track A／B；仍適用於 main@e8b3ef5）

1. 台股紙上下單：PR#33 已合併 `referencePrice`（模擬＝`quote.prev`）與模擬報價合法 tick 取整（R-023）。休市仍回 `MARKET_CLOSED`（D3 未改）；正式站開盤流程 E2E 待補。
2. 公開 proxy 無存取控制、全域共用限流；資料再散布授權待確認（R-024，Track A2＋決策 D1）
3. 串流名額可被單一來源佔滿；訂閱錯誤不回傳、不釋放名額（R-025，Track A2；PR#28 已合併，暴露面已開）
4. 台股回測／研究缺證券交易稅與最低手續費，結論偏樂觀（R-026，Track B1）

### 其他缺口（按優先序）

1. 市場規則精度：漲跌停浮點取整、ETF 升降單位、零股委託類型（R-028、R-029）
2. 狀態：手動斷路器不持久化（R-027）；server STALE probe 未排程（R-030）；研究引擎 target 與持倉可能脫鉤（R-031）
3. browser E2E＋完整 WCAG audit＋viewport 幾何實測；閘門以靜態證據為主（R-032）
4. 真 exchange calendar／corporate-action 調整資料（simplified-weekday 現狀）
5. matching＋reconciliation（立即成交模型現狀，見 R-003）
6. server authority／durable audit／secret management（ADR-005 誠實範圍）
7. provider real-data runtime：Render HTTPS proxy 已部署並通過 quote／history／research smoke；PAPER 下單的 R-023 修正已合併，正式站開盤流程驗收待補。
8. legacy `runBacktest` 融合路徑只維護不擴充（R-021）

## Enforcement（server side）

- Branch protection（main）：**無**（2026-09-14 API 再查驗：404 Branch not protected；啟用建議見決策 D4）
- Rulesets：**無**
- 現狀＝policy＋CI 強、server-side enforcement 缺席；啟用為維護者決策項，
  本文件只記錄、不擅自開。
