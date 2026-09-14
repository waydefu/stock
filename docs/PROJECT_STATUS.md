# Project Status（唯一 current truth）

> 本文件是唯一「現在狀態」來源。歷史快照見 `docs/PROJECT_AUDIT.md`
> （baseline＋歷史，不再設 Current checkpoint）。
> Authority hierarchy：Runtime＋tests ＞ main HEAD ＞ ADR ＞ RISK_REGISTER ＞
> RESEARCH_LEDGER ＞ PROJECT_ROADMAP ＞ PROJECT_AUDIT（歷史）。

## Current（分支驗證；main HEAD 以 GitHub 為準，合併後以 merge commit 更新）

- Last verified main checkpoint：`e8b3ef5`（PR#28 Live UI／SSE client squash-merge；2026-09-22；main CI Quality＋Pages 全綠）
- 本分支：`cursor/track-a-prep-40b7`（純文件：稽核落地＋下階段標定；不改程式）
- Tests：276（本環境 Node 22：`pass 270`／`cancelled 6`／`fail 0`；ubuntu CI 以 GitHub Quality 為準）；`check:static` 27 files；`check:ui` 34/34 WARN 0 FAIL 0
- Quality：以 GitHub required check「Quality」為準（含 Check status sync gate）；禁止在 version-controlled truth 內追逐自身 run ID
- Open PR（文件／deps）：#29 audit（將由本分支／後續 PR 取代或關閉）、#30–#32 Dependabot Pages Actions（Quality 紅燈，暫不合併）
- Benchmark：UI 7.9/10（舊 2.0 保留，見 `UI_UX_BENCHMARK.md`）；`score:ui` 100/100 為靜態原始碼證據，不代表使用者流程可用（R-032）
- Phase 7B／7C：#20–#28 全部 MERGED；`realtimeStream=true`；browser SSE client＋最小 Live UI 已上 main
- Audit：2026-09-14 snapshot 見 `docs/PROJECT_AUDIT.md`；修正計畫見 `docs/FUTURE_PLAN.md`「稽核後收斂 Track A–D」
- **Next executable**：Track **A1**（修 R-023 台股紙上下單 `referencePrice`／tick 對齊）
- Real-data runtime：Render `https://stock-fugle-proxy.onrender.com`；REMOTE_QUOTE_SMOKE=PASS；REAL_HISTORY=PASS；REAL_RESEARCH_SMOKE=PASS（promotion=FAIL，僅研究 gate）；Pages 已注入 proxy URL；
   串流（2026-09-13）：REAL_STREAM_TRANSPORT=PASS；REAL_STREAM_TRADE=BLOCKED_BY_MARKET_CLOSED；5-min soak 見 R-022

## Scope

paper／research-only prototype；無 live broker path；公開 Pages 不持任何憑證。

## Known gaps

### Blockers（2026-09-14 稽核，Track A／B；仍適用於 main@e8b3ef5）

1. 台股紙上下單在 UI 全數被拒：缺 `referencePrice`＋模擬價不對齊 tick（R-023，production 實測，**Track A1＝下一 PR**）
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
7. provider real-data runtime：Render HTTPS proxy 已部署並通過 quote／history／research smoke；下單流程尚未可用（R-023）
8. legacy `runBacktest` 融合路徑只維護不擴充（R-021）

## Enforcement（server side）

- Branch protection（main）：**無**（2026-09-14 API 再查驗：404 Branch not protected；啟用建議見決策 D4）
- Rulesets：**無**
- 現狀＝policy＋CI 強、server-side enforcement 缺席；啟用為維護者決策項，
  本文件只記錄、不擅自開。
