# Project Status（唯一 current truth）

> 本文件是唯一「現在狀態」來源；歷史快照見 `docs/PROJECT_AUDIT.md`。
> **會過期的數字（HEAD／測試數／閘門數）不再手寫**：改由 CI 的 job summary 自動產生
> （`scripts/ci-summary.js`，對應 GitHub Actions「Publish CI summary」步驟）。
> Authority hierarchy：Runtime＋tests ＞ main HEAD ＞ ADR ＞ RISK_REGISTER ＞
> RESEARCH_LEDGER ＞ PROJECT_ROADMAP ＞ PROJECT_AUDIT（歷史）。

## Current

- 真實狀態看兩處：CI job summary（HEAD、測試數、各閘門結果）與
  `docs/RISK_REGISTER.md`（每條風險的修復狀態與證據）。
- 產品邊界：paper／research-only prototype；無 live broker path；公開 Pages 不持任何憑證。

## 收斂進度（Track A–D；計畫與驗收見 `docs/FUTURE_PLAN.md`）

| Track | 項目 | 狀態 |
|---|---|---|
| A1 | 台股紙上單帶參考價（R-023） | 完成 |
| A2 | proxy／串流防濫用（R-024、R-025） | 完成：per-client token bucket、quote 短 TTL 快取、每日上游預算、per-client SSE 上限、upstream 錯誤路由、per-key 串流狀態 |
| A3 | 文件同步（README／STATUS／RISK／LEDGER 對齊） | 持續進行 |
| A4 | Live UI 可行動錯誤態（`STREAM_SUBSCRIBE_FAILED`／`RATE_LIMITED`） | 完成：`#stream-alert` ＋ `STREAM_ERROR_ACTION` |
| B1 | 台股成本模型（R-026） | 進行中：TW FeeModel（證券交易稅＋最低手續費） |
| B2 | 市場規則精度（R-028、R-029） | 完成：整數最小單位漲跌停、商品別跳動單位、零股限價 |
| B3 | 狀態與引擎（R-027、R-030、R-031） | 完成：斷路器持久化、probeStale 排程、target 依成交更新 |
| B4 | 跨平台相容（F-10） | 完成：跨平台語法檢查、proxy lifecycle 測試 |
| C1 | Browser E2E 進 CI（R-032） | 進行中 |
| C2 | 治理加固（branch protection／CodeQL／secret scanning） | 待維護者決策（server-side 設定） |
| C3 | 狀態自動化與文件收斂（R-032） | 完成：CI job summary 自動產生狀態數字 |
| D | 產品與架構（TWSE 休市日曆、拆 `js/app.js`、真實串流撮合、server 帳本） | 逐項決策（見 FUTURE_PLAN） |

## Scope

paper／research-only prototype；無 live broker path；公開 Pages 不持任何憑證。

## Known gaps（非 blocker，按優先序）

1. 真 exchange calendar／corporate-action 調整資料（simplified-weekday 現狀）
2. matching＋reconciliation（立即成交模型現狀，見 R-003）
3. server authority／durable audit／secret management（ADR-005 誠實範圍）
4. 商品別完整規則：ETF／權證的漲跌幅公式、上櫃（TPEx）規則、債券 tick 尚未建模
   （見 Track B2 回報的缺口 G-1～G-8）
5. browser E2E＋完整 WCAG audit＋viewport 幾何實測
6. legacy `runBacktest` 融合路徑只維護不擴充（R-021）

## Enforcement（server side）

- Branch protection（main）：無（2026-09-11 API 查驗：404 Branch not protected）；啟用屬維護者決策。
- Rulesets：無
- 現狀＝policy＋CI 強、server-side enforcement 缺席；本文件只記錄、不擅自開。
