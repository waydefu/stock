# Project Status（唯一 current truth）

> 本文件是唯一「現在狀態」來源。歷史快照見 `docs/PROJECT_AUDIT.md`
> （baseline＋歷史，不再設 Current checkpoint）。
> Authority hierarchy：Runtime＋tests ＞ main HEAD ＞ ADR ＞ RISK_REGISTER ＞
> RESEARCH_LEDGER ＞ PROJECT_ROADMAP ＞ PROJECT_AUDIT（歷史）。

## Current（verified 2026-09-11）

- HEAD：`f07b8d3bad15f2f182dfe7f64251350cf4c3a2aa`（PR#16 Phase 7A squash-merge）
- Branch：`main`；working tree clean
- Tests：142/142；`check:static` 27 files；`check:ui` 28/28 WARN 0 FAIL 0
- Quality：run `34569060956`，同 SHA，success；Pages run `34569060973` success
- Open PR：#17（7B1 Fugle REST＋proxy，待審；head `7d4b908`）
- Benchmark：UI 7.9/10（舊 2.0 保留，見 `UI_UX_BENCHMARK.md`）

## Scope

paper／research-only prototype；無 live broker path；公開 Pages 不持任何憑證。

## Known gaps（非 blocker，按優先序）

1. 真 exchange calendar／corporate-action 調整資料（simplified-weekday 現狀）
2. matching＋reconciliation（立即成交模型現狀，見 R-003）
3. server authority／durable audit／secret management（ADR-005 誠實範圍）
4. provider real-data runtime（7B1 在審；proxy 部署待 ADR-006 決策）
5. browser E2E＋完整 WCAG audit＋viewport 幾何實測
6. legacy `runBacktest` 融合路徑只維護不擴充（R-021）

## Enforcement（server side）

- Branch protection（main）：**無**（2026-09-11 API 查驗：404 Branch not protected）
- Rulesets：**無**
- 現狀＝policy＋CI 強、server-side enforcement 缺席；啟用為維護者決策項，
  本文件只記錄、不擅自開。
