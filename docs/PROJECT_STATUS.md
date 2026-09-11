# Project Status（唯一 current truth）

> 本文件是唯一「現在狀態」來源。歷史快照見 `docs/PROJECT_AUDIT.md`
> （baseline＋歷史，不再設 Current checkpoint）。
> Authority hierarchy：Runtime＋tests ＞ main HEAD ＞ ADR ＞ RISK_REGISTER ＞
> RESEARCH_LEDGER ＞ PROJECT_ROADMAP ＞ PROJECT_AUDIT（歷史）。

## Current（分支驗證；main HEAD 以 GitHub 為準，合併後以 merge commit 更新）

- Last verified main checkpoint：`b8ff423`（PR#23 Pages→Render proxy 接線 squash-merge）
- 本分支：`chore/post-23-convergence`，working tree 見下述提交後為 clean
- Tests：183/183；`check:static` 27 files；`check:ui` 32/32 WARN 0 FAIL 0
- Quality：見本 PR required check「Quality」（含 Check status sync gate）；禁止在 version-controlled truth 內追逐自身 run ID
- Open PR：本分支 `chore/post-23-convergence`（base main；編號與 CI 以 GitHub 為準）
- Benchmark：UI 7.9/10（舊 2.0 保留，見 `UI_UX_BENCHMARK.md`）
- Phase 7B1：MERGED；Phase 7B2（#20）＋proxy deploy-ready（#21）＋Docker runtime fix（#22）＋Pages 接線（#23）：MERGED
- Real-data runtime：Render `https://stock-fugle-proxy.onrender.com`；REMOTE_QUOTE_SMOKE=PASS；REAL_HISTORY=PASS；REAL_RESEARCH_SMOKE=PASS（promotion=FAIL，僅研究 gate，不影響 smoke）；Pages deployed artifact 已驗注入 URL（2026-09-11 curl 實證）；真瀏覽器 acceptance PASS（2026-09-11：Fugle quote＋232 bars 研究＋GATE FAIL＋provenance FUGLE，見本 PR body）

## Scope

paper／research-only prototype；無 live broker path；公開 Pages 不持任何憑證。

## Known gaps（非 blocker，按優先序）

1. 真 exchange calendar／corporate-action 調整資料（simplified-weekday 現狀）
2. matching＋reconciliation（立即成交模型現狀，見 R-003）
3. server authority／durable audit／secret management（ADR-005 誠實範圍）
4. provider real-data runtime：Render HTTPS proxy 已部署並通過 Fugle remote quote／historical bars／research smoke；
   Pages deployed artifact 已注入 proxy URL（curl 實證）且真瀏覽器 acceptance PASS（2026-09-11）；
   promotion=FAIL 僅代表目前策略不具升級資格，不影響資料鏈 smoke PASS
5. browser E2E＋完整 WCAG audit＋viewport 幾何實測
6. legacy `runBacktest` 融合路徑只維護不擴充（R-021）

## Enforcement（server side）

- Branch protection（main）：**無**（2026-09-11 API 查驗：404 Branch not protected）
- Rulesets：**無**
- 現狀＝policy＋CI 強、server-side enforcement 缺席；啟用為維護者決策項，
  本文件只記錄、不擅自開。
