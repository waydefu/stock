# Risk Register

## Scoring

- Severity：P0 financial／safety、P1 major correctness／security、P2 maintainability／UX、P3 cosmetic。
- Confidence：Confirmed 代表已由 current HEAD／runtime path／tests 證實；Needs verification 代表有具體風險但尚無完整 evidence。

| ID | Sev. | Confidence | Risk / root cause | Impact | Evidence | Fix / verification |
|---|---|---|---|---|---|---|
| R-001 | P0 | Confirmed at baseline; fixed in Phase 1 | `PaperBroker.snapshot()` 沒有 `dailyPnl`；`RiskEngine` 以 `undefined → 0`，正常 UI path 的日損斷路器不會依實際日損觸發。 | 風控門檻形同未接線。 | Baseline：`js/paper.js:60-81`、`js/risk.js:26-35`、`js/app.js:213-231`；修復證據：`tests/risk-integration.test.js` daily-PnL wiring。 | 已定義 session daily-PnL／reference equity；保留 integration test 防回歸。 |
| R-002 | P0 | Confirmed at baseline; fixed in Phase 1 | preview 通過後，confirm 直接 `placeOrder()`，沒有重新驗證 risk／cash／position／kill switch。 | preview 與實際 commit 間狀態變更可繞過風控或造成 stale order。 | Baseline：`js/app.js:213-255`；`js/paper.js:84-121`；修復證據：`tests/risk-integration.test.js` stale cash／kill-switch tests 與 browser confirm test。 | `js/order-service.js` 在 commit boundary 重新 snapshot → risk → place；拒絕時不改帳。 |
| R-003 | P1 | Confirmed; lifecycle now explicit, fill realism still open | `PaperBroker.placeOrder()` 仍是 immediate simulation，但現在留下 `NEW → VALIDATED → FILLED` transition events。 | 限價／部分成交／撤單語義仍未實作，不能暗示真實撮合。 | 修復證據：`js/order-state.js`、`tests/order-state.test.js`、`tests/paper.test.js`。 | 下一步建立 OPEN／PARTIALLY_FILLED／CANCELED／EXPIRED semantics，或在 UI／docs 明確維持 immediate simulation。 |
| R-004 | P1 | Confirmed at baseline; fixed in Phase 2 | order 沒有 client idempotency enforcement；`clientId` 只是欄位。 | 重送 intent 可能重複改帳。 | Baseline：`js/paper.js:84-121`；修復證據：`clientOrderId` duplicate test 與 `js/order-service.js` replay path。 | duplicate clientOrderId 回傳原 fill，不再重複改帳。 |
| R-005 | P1 | Confirmed at baseline; fixed in Phase 3 | localStorage shallow merge、無 schema version／migration／完整 validation。 | 使用者可修改或破壞帳本；資料形狀不可信。 | Baseline：`js/paper.js:42-55`；修復證據：malformed persisted account test、schemaVersion 1。 | malformed account reset to safe defaults；仍待正式 migration policy。 |
| R-006 | P1 | Confirmed | AuditLog 只在 memory，reload 消失；class 有 `clear()`；event schema 無 version/id。 | 無法宣稱 durable／append-only audit。 | `js/risk.js:70-90`；`js/app.js:40-43`。 | 文件降格或建立 prototype persistence；event schema、formula injection test。 |
| R-007 | P1 | Confirmed at baseline; fixed in Phase 1 | `maxDrawdownPct` denominator 固定 initial capital。 | equity peak 後的 drawdown percentage 可能被低估／語義錯誤。 | Baseline：`js/backtest.js:153-180`；修復證據：peak-denominator golden test。 | 使用 equity peak denominator；保留 golden test。 |
| R-008 | P1 | Confirmed at baseline; fixed in Phase 1 | Sharpe 固定 `sqrt(252)`，沒有 timeframe／risk-free／minimum sample policy。 | 非日線資料或小樣本的風險調整結果會誤導。 | Baseline：`js/backtest.js:164-180`；修復證據：`periodsPerYear` golden test。 | annualization 參數化；risk-free／minimum-sample policy 仍待。 |
| R-009 | P1 | Confirmed | dynamic `innerHTML` 組合標的／名稱／事件細節。 | 目前 seed data 受控；未來 provider／user data 進入後存在 DOM XSS 邊界。 | `js/app.js:64-68,105-115,163,189-200,235,267-275`。 | 對外部／使用者資料改 safe DOM API 或嚴格 escape；security smoke test。 |
| R-010 | P1 | Confirmed at baseline; fixed in Phase 3 | CSV formula injection：event／details 欄位沒有針對 `= + - @` 的明確 policy。 | 匯入 spreadsheet 時可能被當成公式。 | Baseline：`js/risk.js:81-90`；修復證據：malicious event CSV test。 | dangerous prefixes 以 apostrophe neutralize；仍需決定正式 export policy。 |
| R-011 | P1 | Confirmed at baseline; fixed in Phase 2 | `Date.now()` 直接生成 order id；clock 不可注入。 | replay、snapshot、state-machine test 不完全 deterministic。 | Baseline：`js/paper.js:105-107`；修復證據：injected `now`／`idGenerator` boundary 與 order event tests。 | PaperBroker 支援 injected ID generator；prototype UI client id 仍待 production UUID policy。 |
| R-012 | P1 | Confirmed at baseline; fixed in Phase 3 | Actions 使用 mutable major tag `@v5`，未 immutable SHA pin；未見 Dependabot／security workflows。 | CI supply-chain 變更不可完全回溯。 | Baseline：`.github/workflows/quality.yml:23-33`；修復證據：full SHA refs、`.github/dependabot.yml`、官方 secure-use source [94]。 | checkout/setup-node pinned full SHA、Dependabot weekly；仍待 secret/code/dependency scanning policy。 |
| R-013 | P1 | Confirmed at baseline; partial contract in Phase 1 | TW／US calendar、tick size、price limit、odd-lot、corporate actions 未抽象；data generator 跳過週末而非市場 calendar。 | 真實 adapter／回測切換時金融語義錯誤。 | Baseline：`js/data.js:70-90`；修復證據：`js/market-rules.js` TW sourced partial contract、`tests/market-rules.test.js`。 | 仍待 TWSE exceptions／tick schedule、US venue rules、calendar／corporate-actions integration；prototype 尚未強制到 broker。 |
| R-014 | P2 | Confirmed | indicator／closes 在每根 bar 重算。 | 資料量成長後 backtest 可能 O(n²)。 | `js/backtest.js:17-44,70`。 | benchmark 250／10k／100k 後才選 incremental implementation。 |
| R-015 | P2 | Confirmed | UI 設計 tokens 被 55 個 inline styles 繞過；canvas／table／empty／motion 不完整。 | 維護與視覺一致性差；錯誤時可能 blank。 | `index.html` current HEAD；`css/styles.css` 無一般 transition／shadow。 | 依 `docs/UI_UX_BENCHMARK.md` P0/P1/P2。 |
| R-016 | P2 | Confirmed | modal 無 focus trap／Escape／focus restore；tabs 缺完整 controls／hidden semantics。 | keyboard／screen reader flow 不完整。 | `index.html:29-36,105-108`；`js/app.js:54-61,303-308`。 | browser accessibility regression tests。 |
| R-017 | P2 | Confirmed | audit／paper 只在 session/localStorage；kill switch 為 memory state。 | reload／多 tab／多 user semantics 不明。 | `js/risk.js:19-54`、`js/paper.js:31-58`。 | 明確 scope 或 persistence contract；不要把 localStorage 當 security。 |
| R-018 | P2 | Needs verification | account equity／daily PnL、fees、slippage 與 paper order 的 accounting 未統一。 | dashboard／risk／paper／backtest 數字可能各自正確但不可比較。 | `js/app.js:90-103`、`js/paper.js:60-80`、`js/backtest.js:168-180`。 | 建立 AccountSnapshot／Accounting invariants 與 integration tests。 |

## Immediate priority

R-001／R-002 已在 Phase 1 修復並有 integration／browser evidence。下一個 correctness gate 是 R-003 paper order lifecycle、R-007 drawdown、R-008 Sharpe 的 golden tests；UI P0 延到這些 domain evidence 穩定後。
