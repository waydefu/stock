# Project Status（唯一 current truth）

> 本文件是唯一「現在狀態」來源。歷史快照見 `docs/PROJECT_AUDIT.md`
> （baseline＋歷史，不再設 Current checkpoint）。
> Authority hierarchy：Runtime＋tests ＞ main HEAD ＞ ADR ＞ RISK_REGISTER ＞
> RESEARCH_LEDGER ＞ PROJECT_ROADMAP ＞ PROJECT_AUDIT（歷史）。

## Current（分支驗證；main HEAD 以 GitHub 為準，合併後以 merge commit 更新）

- Last verified main checkpoint：`147fd0d`（PR#21 proxy deployment readiness squash-merge）
- 本分支：`fix/docker-node-user`，working tree 見下述提交後為 clean
- Tests：183/183；`check:static` 27 files；`check:ui` 31/31 WARN 0 FAIL 0
- Quality：見本 PR required check「Quality」（含 Check status sync gate）；禁止在 version-controlled truth 內追逐自身 run ID
- Open PR：#22（本分支；base main）— `server/Dockerfile` 改用 image 內建 `node` 使用者（bookworm-slim 內建 `proxy` 帳號致 `useradd proxy` exit 9）
- Benchmark：UI 7.9/10（舊 2.0 保留，見 `UI_UX_BENCHMARK.md`）
- Phase 7B1：MERGED；Phase 7B2（#20）＋proxy deploy-ready（#21）：MERGED；本分支僅修 Dockerfile 使用者名稱

## Scope

paper／research-only prototype；無 live broker path；公開 Pages 不持任何憑證。

## Known gaps（非 blocker，按優先序）

1. 真 exchange calendar／corporate-action 調整資料（simplified-weekday 現狀）
2. matching＋reconciliation（立即成交模型現狀，見 R-003）
3. server authority／durable audit／secret management（ADR-005 誠實範圍）
4. provider real-data runtime：Fugle REST adapter boundary 已 merge；
   trusted proxy 程式完成但尚未部署，real smoke 仍待 credential／runtime
   （見 ADR-006 Proposed；構建環境無公開主機／部署憑證）；UI Fugle 模式＋研究 runner 已就緒待真後端
5. browser E2E＋完整 WCAG audit＋viewport 幾何實測
6. legacy `runBacktest` 融合路徑只維護不擴充（R-021）

## Enforcement（server side）

- Branch protection（main）：**無**（2026-09-11 API 查驗：404 Branch not protected）
- Rulesets：**無**
- 現狀＝policy＋CI 強、server-side enforcement 缺席；啟用為維護者決策項，
  本文件只記錄、不擅自開。
