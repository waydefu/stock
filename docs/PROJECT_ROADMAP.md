# Project Roadmap

## Status

Current checkpoint `985e755` has 54 tests green and Quality green. Baseline and current evidence are kept separately in `docs/PROJECT_AUDIT.md`; remaining work is explicitly scoped below.

## Phase 0 — Baseline（完成）

- 讀取 HEAD、tree、治理、程式、測試與 CI。
- 跑 `npm run check:static`、`npm run check:syntax`、`npm test`、`git diff --check`。
- 建立 `docs/PROJECT_AUDIT.md`、`docs/RISK_REGISTER.md`、`docs/RESEARCH_LEDGER.md`。
- 目前證據：18 tests passed；remote Quality success。

## Phase 1 — Domain correctness（P0 完成；P1 partial）

已完成：

- `PaperBroker.snapshot()` 輸出 session `dailyPnl` 與 reference equity。
- `executePaperOrder()` 在 confirm commit boundary 重新 snapshot → risk → place。
- stale cash 與 kill-switch confirm integration tests。
- browser confirm revalidation smoke test。

仍待：full exchange calendar／holiday exceptions、corporate actions、正式 risk-free／minimum-sample metric policy、non-zero fee models。

Phase 1 additions：

- backtest peak drawdown／periodsPerYear／malformed bar validation completed with golden tests。
- `AccountSnapshot` now defines cash／marketValue／equity、realized／unrealized／total PnL、daily PnL、fees and invariants。
- TW／US `MarketRules` contract added; `MarketSessionClock` uses market-local timezone while calendar remains simplified-weekday。
- `MarketRules` TW partial／US simplified contract；shared lot validation 已接 RiskEngine／PaperBroker／UI intent。
- `SimplifiedWeekdayCalendar` 已接 deterministic data layer；corporate-action types 已定義但沒有調整資料。

Acceptance already covered by `tests/risk-integration.test.js`: daily loss wires through the normal snapshot path, and confirm-time state changes reject without mutating the account.

### 1C Backtest metric contract

- 先寫人工 5–20 bars golden fixtures。
- 定義 max drawdown denominator、Sharpe timeframe／annualization／minimum samples。
- 檢查 parameter validation、bar validation、time ordering。
- Acceptance：golden expected cash/equity/trades/fees/drawdown 全部固定通過。

### 1D Market-rule boundary

- 先建立 `MarketRules` contract，不接 live data。
- 明確標記目前日線 simulated market 的 limitation。
- Acceptance：TW／US 的 calendar、timezone、currency、tick／quantity assumptions 不再散落於 UI。

## Phase 2 — Paper order semantics（immediate mode complete；matching remains open）

已完成：

- deterministic `NEW → VALIDATED → FILLED` immediate state machine；legal `OPEN`／`CANCELED` transitions 已有 contract tests。
- transition event list with timestamps/reason。
- `ExecutionMode.IMMEDIATE` 與 future `MATCHING` boundary；matching 未實作時會明確失敗。
- clientOrderId idempotency、injected clock／ID generator、stable error categories。

仍待：

- partial fill／cancel pending／expiry 的 matching semantics。
- broker reconciliation contract 與 provider order IDs。
- fill model decision beyond immediate simulation。

Acceptance：非法 transition 拒絕；duplicate intent 不重複改帳；rejected order 不改 state；UI／docs 不暗示目前具有真實 limit matching。
## Phase 3 — Persistence／audit／security（local prototype scope defined；server-grade remains open）

已完成：

- localStorage schemaVersion 1 與 malformed account safe reset。
- CSV formula-prefix neutralization regression test。
- AuditLog version／eventId／deterministic ID、CSV schema、移除 clear()。
- AuditLog 以 versioned localStorage 進行 session persistence；明確不是 tamper-proof／server append-only audit。
- dynamic text 主要 sinks 加入 `escapeHtml` helper 與 regression test。
- GitHub Actions full SHA pin、Dependabot weekly config、官方 secure-use review。

仍待：

- formal migration policy（schema version bump／migration path）。
- actor／request id、multi-tab scope、server-grade append-only audit。
- dynamic `innerHTML` 對 provider／user input 的 safe DOM boundary。
- secret scanning、code scanning、dependency review policy。

## Phase 4 — Test hardening（domain core complete；browser/a11y remaining）

已完成：

- risk integration、preview／confirm stale-state、kill-switch、order state-machine tests。
- accounting golden tests、storage corruption tests、1,000-intent deterministic fuzz。
- market-session／simplified-calendar／corporate-action contract tests。

仍待：

- browser smoke：rejected order、duplicate submit、responsive、多 tab。
- full accessibility：contrast、focus、dialog、table semantics、reduced motion。

## Phase 5 — Architecture cleanup（P1/P2）

只在 tests 保護後做：

- injectable Clock／IdGenerator
- `MarketDataAdapter` port
- `PaperBroker`／future Broker adapter separation
- `OrderService` commit boundary
- domain error classes
- reduce `app.js` orchestration size

不因重構而引入 React、bundler、TypeScript 或大型 runtime dependency。

## Phase 6 — UI/UX benchmark P0/P1/P2（core accessibility P1 complete；states remaining）

已完成 P0：

- inline styles 清除（static HTML/runtime template count 0）。
- semantic utility tokens、primary contrast pair、stable canvas baseline、sticky table header。
- purposeful page/control motion tokens、reduced-motion、safe DOM escaping。

已完成 core P1：

- tablist／tab／tabpanel、aria-controls、hidden inactive panels、arrow-key navigation。
- dialog description、focus entry、focus trap、Escape、backdrop close、trigger restore。
- table `scope="col"` semantics。

仍待 P1/P2：

- loading／empty／error／permission states。
- KPI hierarchy、dialog focus trap／Escape／restore、tabs semantics。
- crosshair／tooltip、完整 responsive degradation、WCAG browser audit。
- order acknowledgement motion 與完整 state-driven UI。

## Phase 7 — Adapter readiness（P1/P2）

先 fake contract，再考慮 paper provider：

- Fugle／Shioaji：TW data／simulation assumptions、rate limit、corporate actions。
- Alpaca：paper endpoint、paper/live separation。
- IBKR：paper semantics、order status、reconciliation。

仍不得自動進 live trading。

## Phase 8 — Performance／observability（performance baseline complete；observability remains P2）

已完成 performance evidence：

- Same Node 24 local environment、same hold strategy、same synthetic OHLCV shape。
- `runBacktest` precomputes signal arrays instead of remapping/recalculating indicators per bar。
- 250 bars：4.863ms → 2.894ms。
- 1,000 bars：16.201ms → 4.741ms。
- 5,000 bars：225.592ms → 6.175ms。
- 10,000 bars：827.709ms → 10.299ms。
- 100,000 bars：post-change 50.615ms；before path intentionally not run because the old O(n²) path was not a safe benchmark target。

仍待：

- JS／CSS／HTML first-load field/lab baseline。
- chart redraw／resize measurements。
- structured adapter diagnostics、stale data、request latency metrics。
## Phase 9 — Production-readiness study（不等於 production deploy）

只做 gap analysis：auth、MFA、secrets、multi-tenant、persistent audit、reconciliation、legal／data licensing、incident response。live broker、正式部署、branch protection 仍需明確決策。
