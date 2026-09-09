# Risk Register

## Scoring

- Severity：P0 financial／safety、P1 major correctness／security、P2 maintainability／UX、P3 cosmetic。
- Confidence：Confirmed 代表已由 current HEAD／runtime path／tests 證實；Needs verification 代表有具體風險但尚無完整 evidence。

| ID | Sev. | Confidence | Risk / root cause | Impact | Evidence | Fix / verification |
|---|---|---|---|---|---|---|
| R-001 | P0 | Confirmed | `PaperBroker.snapshot()` 沒有 `dailyPnl`；`RiskEngine` 以 `undefined → 0`，正常 UI path 的日損斷路器不會依實際日損觸發。 | 風控門檻形同未接線。 | `js/paper.js:60-81`、`js/risk.js:26-35`、`js/app.js:213-231`；現有 test 手工傳 dailyPnl。 | 定義 AccountSnapshot daily-PnL contract；先寫 integration red test，再修 snapshot／風控接線。 |
| R-002 | P0 | Confirmed | preview 通過後，confirm 直接 `placeOrder()`，沒有重新驗證 risk／cash／position／kill switch。 | preview 與實際 commit 間狀態變更可繞過風控或造成 stale order。 | `js/app.js:213-255`；`js/paper.js:84-121`。 | 在 authoritative commit boundary 重讀並重驗；測 cash、kill switch、risk config 變化。 |
| R-003 | P1 | Confirmed | `PaperBroker.placeOrder()` 直接改帳並 `status: filled`。 | 限價／部分成交／撤單語義被假裝成即時成交。 | `js/paper.js:84-121`。 | 先定義 prototype fill model；建立 order state machine 與 event tests。 |
| R-004 | P1 | Confirmed | order 沒有 client idempotency enforcement；`clientId` 只是欄位。 | 重送 intent 可能重複改帳。 | `js/paper.js:84-121`。 | `clientOrderId` unique constraint；duplicate regression test。 |
| R-005 | P1 | Confirmed | localStorage shallow merge、無 schema version／migration／完整 validation。 | 使用者可修改或破壞帳本；資料形狀不可信。 | `js/paper.js:42-55`。 | versioned schema、safe parse、migration／corrupt-state test。 |
| R-006 | P1 | Confirmed | AuditLog 只在 memory，reload 消失；class 有 `clear()`；event schema 無 version/id。 | 無法宣稱 durable／append-only audit。 | `js/risk.js:70-90`；`js/app.js:40-43`。 | 文件降格或建立 prototype persistence；event schema、formula injection test。 |
| R-007 | P1 | Confirmed | `maxDrawdownPct` denominator 固定 initial capital。 | equity peak 後的 drawdown percentage 可能被低估／語義錯誤。 | `js/backtest.js:153-180`。 | golden fixtures 定義 peak denominator，再修與回歸測試。 |
| R-008 | P1 | Confirmed | Sharpe 固定 `sqrt(252)`，沒有 timeframe／risk-free／minimum sample policy。 | 非日線資料或小樣本的風險調整結果會誤導。 | `js/backtest.js:164-180`。 | metric contract、frequency metadata、small-sample behavior。 |
| R-009 | P1 | Confirmed | dynamic `innerHTML` 組合標的／名稱／事件細節。 | 目前 seed data 受控；未來 provider／user data 進入後存在 DOM XSS 邊界。 | `js/app.js:64-68,105-115,163,189-200,235,267-275`。 | 對外部／使用者資料改 safe DOM API 或嚴格 escape；security smoke test。 |
| R-010 | P1 | Needs verification | CSV formula injection：event／details 欄位沒有針對 `= + - @` 的明確 policy。 | 匯入 spreadsheet 時可能被當成公式。 | `js/risk.js:81-90`。 | 建立 malicious CSV fixture，決定 neutralization policy 並測。 |
| R-011 | P1 | Confirmed | `Date.now()` 直接生成 order id；clock 不可注入。 | replay、snapshot、state-machine test 不完全 deterministic。 | `js/paper.js:105-107`。 | injectable Clock／IdGenerator；golden order event。 |
| R-012 | P1 | Confirmed | Actions 使用 mutable major tag `@v5`，未 immutable SHA pin；未見 Dependabot／security workflows。 | CI supply-chain 變更不可完全回溯。 | `.github/workflows/quality.yml:23-33`；tree 無相關 workflow。 | 先研究 GitHub guidance，再決定 SHA policy／Dependabot。 |
| R-013 | P1 | Confirmed | TW／US calendar、tick size、price limit、odd-lot、corporate actions 未抽象；data generator 跳過週末而非市場 calendar。 | 真實 adapter／回測切換時金融語義錯誤。 | `js/data.js:70-90`；`DISCLAIMER.md:5-6`。 | `MarketRules` contract；官方規則 research ledger；prototype limitation。 |
| R-014 | P2 | Confirmed | indicator／closes 在每根 bar 重算。 | 資料量成長後 backtest 可能 O(n²)。 | `js/backtest.js:17-44,70`。 | benchmark 250／10k／100k 後才選 incremental implementation。 |
| R-015 | P2 | Confirmed | UI 設計 tokens 被 55 個 inline styles 繞過；canvas／table／empty／motion 不完整。 | 維護與視覺一致性差；錯誤時可能 blank。 | `index.html` current HEAD；`css/styles.css` 無一般 transition／shadow。 | 依 `docs/UI_UX_BENCHMARK.md` P0/P1/P2。 |
| R-016 | P2 | Confirmed | modal 無 focus trap／Escape／focus restore；tabs 缺完整 controls／hidden semantics。 | keyboard／screen reader flow 不完整。 | `index.html:29-36,105-108`；`js/app.js:54-61,303-308`。 | browser accessibility regression tests。 |
| R-017 | P2 | Confirmed | audit／paper 只在 session/localStorage；kill switch 為 memory state。 | reload／多 tab／多 user semantics 不明。 | `js/risk.js:19-54`、`js/paper.js:31-58`。 | 明確 scope 或 persistence contract；不要把 localStorage 當 security。 |
| R-018 | P2 | Needs verification | account equity／daily PnL、fees、slippage 與 paper order 的 accounting 未統一。 | dashboard／risk／paper／backtest 數字可能各自正確但不可比較。 | `js/app.js:90-103`、`js/paper.js:60-80`、`js/backtest.js:168-180`。 | 建立 AccountSnapshot／Accounting invariants 與 integration tests。 |

## Immediate priority

先處理 R-001、R-002；它們是安全門檻實際失效，不是 UI 問題。R-003、R-007、R-008 接著做 domain golden tests。UI P0 延到 critical path 有 integration evidence 後。
