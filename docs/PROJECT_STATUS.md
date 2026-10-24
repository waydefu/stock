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
- Proxy anti-abuse state 已從 HTTP router 抽成 `server/proxy-anti-abuse.js`；限流／budget／cache 行為由單測與既有 proxy integration tests 鎖定。
- Research execution 時間軸：next-bar-open intent 只在實際下一根開盤改帳；未來價格不得回寫前一根 equity（R-033）。
- **當前優先序**：技術債／模組化／治理收斂 → 純數學策略 Automated Paper Trading v1（真實行情 forward test）；第一階段不使用真錢、不接 live broker。

## 收斂進度（Track A–D；計畫與驗收見 `docs/FUTURE_PLAN.md`）

| Track | 項目 | 狀態 |
|---|---|---|
| A1 | 台股紙上單帶參考價（R-023） | 完成 |
| A2 | proxy／串流防濫用（R-024、R-025） | 完成：per-client token bucket、quote 短 TTL 快取、每日上游預算、per-client SSE 上限、upstream 錯誤路由、per-key 串流狀態 |
| A3 | 文件同步（README／STATUS／RISK／LEDGER 對齊） | 持續進行 |
| A4 | Live UI 可行動錯誤態（`STREAM_SUBSCRIBE_FAILED`／`RATE_LIMITED`） | 完成：`#stream-alert` ＋ `STREAM_ERROR_ACTION` |
| B1 | 台股成本模型（R-026／R-018） | 完成：`js/tw-fee-model.js`（證交稅＋最低手續費）；正式 App 的 TW Paper 已注入一般股票成本政策，Broker constructor 仍可 DI zero-fee |
| B2 | 市場規則精度（R-028、R-029） | 完成：整數最小單位漲跌停、商品別跳動單位、零股限價 |
| B3 | 狀態與引擎（R-027、R-030、R-031） | 完成：斷路器持久化、probeStale 排程、target 依成交更新 |
| B4 | 跨平台相容（F-10） | 完成：跨平台語法檢查、proxy lifecycle 測試 |
| C1 | Browser E2E 進 CI（R-032） | 完成：`.github/workflows/e2e.yml`＋`tests/e2e/*`（含 R-023 突變回放） |
| C2 | 治理加固（branch protection／CodeQL／secret scanning／dependency review） | 完成：main branch protection（required `Quality`）、CodeQL workflow、secret scanning 已啟用、dependency review workflow |
| C3 | 狀態自動化與文件收斂（R-032） | 完成：CI job summary 自動產生狀態數字；Node 24 `ℹ tests/pass/fail` 解析已有單測防回歸 |
| D | 產品與架構（TWSE 休市日曆、拆 `js/app.js`、真實串流撮合、server 帳本） | D2 完成（TWSE 官方 2026 休市日快照）；D1／D3／D4 逐項決策（見 FUTURE_PLAN） |
| E1 | Automated Paper | 完成：Promotion Gate→數學 Signal→10% sizing→Risk→Paper costs→reconciliation；TW 單標的、browser runner |
| E2 | Paper Matching v1 | 完成核心：DAY limit `OPEN→FILLED/CANCELED/EXPIRED`、reservation、fill-time Risk、Auto Runner 接線；無 L2／partial fill |
| E3 | Server Auto Paper authority | 核心完成、部署未啟用：共享 Promotion evaluator、strict durable state、atomic file store、server scheduler、startup/shutdown lifecycle；需 confirmed persistent storage＋always-on compute 才可 enable |

## 真實資料與部署實測（2026-10-22，PR#37 合併後）

- 線上 proxy：`https://stock-fugle-proxy.onrender.com`（Render，由 main 自動部署）→ `healthz` 200。
- **新版防濫用已上線實測**：同一來源連打 69 次後回 429 `RATE_LIMITED`
  （訊息「你的來源請求過於頻繁，請稍後再試（per-client 保護）」）——舊版是全 process 共用限流；
  單元測試鎖住「另一個 client 仍可取得報價」與「quote TTL 內只打一次上游」。
- `npm run smoke:fugle:remote` → `REMOTE_QUOTE_SMOKE=PASS`（2330 報價 2385，freshness=STALE＝休市後的誠實標示）。
- `npm run smoke:research:remote` → `REMOTE_RESEARCH_SMOKE=PASS`（233 根真實日 K、2025-11-06→2026-10-22、
  OOS 交易 1 筆、OOS 損益 +7,440（含稅費 1,505）、promotion=FAIL → 弱證據不晉升）。
- `npm run smoke:stream:remote` → `REAL_STREAM_TRANSPORT=PASS`（state 序列
  CONNECTING→AUTHENTICATING→SUBSCRIBING→LIVE→STALE、keepalive 正常、35 秒內無 silent stale）；
  `REAL_STREAM_TRADE=BLOCKED_BY_MARKET_CLOSED`（台北 19:57 休市，逐筆無資料屬正常）。
- GitHub Pages：main 合併後由 `pages.yml` 自動重新部署。

## Scope

paper／research-only prototype；無 live broker path；公開 Pages 不持任何憑證。

## Known gaps（非 blocker，按優先序）

1. corporate-action（除權息）調整資料尚未取得與套用（TWSE 休市日已改用官方 2026 快照，見 D2）
2. matching microstructure realism（R-003）：核心 MATCHING 已完成，但目前只有 last-trade touch＋full-fill-at-limit；無 L2 queue／成交量配置／partial fill
3. server authority **程式核心已完成但目前部署仍 disabled**：現有 Free Render 會休眠且無 Persistent Disk；要開始 unattended forward test，需先提供 always-on compute＋confirmed persistent storage（R-034）
4. 商品別完整規則：ETF／權證的漲跌幅公式、上櫃（TPEx）規則、債券 tick 尚未建模
   （見 Track B2 回報的缺口 G-1～G-8）
5. Paper 成本殘留：尚無 acquisition-session provenance，故不套當沖減稅；US 非佣金成本尚未來源化，現在明示 zero-fee
6. 完整 WCAG audit＋viewport 幾何實測（Browser E2E 已在 CI）
7. legacy `runBacktest` 的內建訊號已收斂到 `js/classic-strategies.js` 並有 layered parity；剩 sizing／execution／metrics 相容路徑待 UI 遷移後退役（R-021）
8. UI orchestration：Live stream 與 Risk/Audit presentation 已抽離；`js/app.js` 仍需續拆交易／研究／導覽職責
9. `scripts/check-ui.js` 已把 runtime／security boundary gates 抽到 `scripts/ui-gates/runtime-boundaries.js`；其餘視覺／a11y gates 後續按領域續拆
10. 24/7 部署條件尚未成立：server scheduler 已可用且 fail-closed，但目前 Free Render proxy 不符合 always-on／durable storage 條件；因此 production env 保持 `AUTO_PAPER_SERVER_ENABLED!=1`（R-034）

## Enforcement（server side）

- Branch protection（main）：**已啟用**（2026-10-22，API 查驗）：required status check＝`Quality`；
  不允許 force push／刪除分支；`enforce_admins` 未開（維護者可 bypass）。
  `Browser E2E` workflow 已在 main 並會執行，但尚未加為 required context；`CodeQL` 同樣是政策必跑、非 server required。
- CodeQL（code scanning）：workflow 已上 main（`.github/workflows/codeql.yml`，javascript-typescript）。
- Secret scanning：公開 repo 預設已開（含 push protection），2026-10-22 API 查驗為 `enabled`。
- Dependency review：`.github/workflows/dependency-review.yml`（PR 檢視依賴變更）。
- Ruleset 目前為空；required PR review 數與貢獻者身份一致性仍未強制。單人＋agent repo 暫不把「另一人 review」當必要條件，避免無意義自鎖。
- `check:status` 門禁：改了程式／測試／閘門的 PR 必須同步本文件；Dependabot 的機械式版本更新豁免這項
  （內容契約照跑），避免為無關的 action 升級而改文件。
