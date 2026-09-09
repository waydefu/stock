# Project Roadmap

## Status

目前 HEAD 的 baseline checks 全綠，但 audit 找到兩個 P0 correctness／safety issue；因此 roadmap 先走 domain correctness，不先做視覺大改。

## Phase 0 — Baseline（完成）

- 讀取 HEAD、tree、治理、程式、測試與 CI。
- 跑 `npm run check:static`、`npm run check:syntax`、`npm test`、`git diff --check`。
- 建立 `docs/PROJECT_AUDIT.md`、`docs/RISK_REGISTER.md`、`docs/RESEARCH_LEDGER.md`。
- 目前證據：18 tests passed；remote Quality success。

## Phase 1 — Domain correctness（完成 P0 wiring；剩餘 metrics／market rules）

已完成：

- `PaperBroker.snapshot()` 輸出 session `dailyPnl` 與 reference equity。
- `executePaperOrder()` 在 confirm commit boundary 重新 snapshot → risk → place。
- stale cash 與 kill-switch confirm integration tests。
- browser confirm revalidation smoke test。

仍待：drawdown／Sharpe golden contract、parameter／bar validation、MarketRules integration。

Phase 1 additions：

- backtest peak drawdown／periodsPerYear／malformed bar validation completed with golden tests。
- TW／US `MarketRules` contract added；TW regular／odd-lot／price-limit baseline is sourced, US remains simplified。

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

## Phase 2 — Paper order semantics（部分完成；P1 remains）

已完成：

- deterministic `NEW → VALIDATED → FILLED` state machine。
- transition event list with timestamps/reason.
- invalid transition tests。

仍待：

- `OPEN`／`PARTIALLY_FILLED`／`CANCEL_PENDING`／`CANCELED`／`EXPIRED` semantics。
- clientOrderId idempotency。
- injected Clock／IdGenerator contract。
- fill model decision: immediate simulation must remain explicitly named, or add deterministic matching model。

Acceptance：非法 transition 拒絕；duplicate intent 不重複改帳；rejected order 不改 state；UI／docs 不暗示目前具有真實 limit matching。
## Phase 3 — Persistence／audit／security（部分完成；P1 remains）

已完成：

- localStorage schemaVersion 1 與 malformed account safe reset。
- CSV formula-prefix neutralization regression test。
- AuditLog version／eventId／deterministic ID、CSV schema、移除 clear()。
- dynamic text 主要 sinks 加入 `escapeHtml` helper 與 regression test。
- GitHub Actions full SHA pin、Dependabot weekly config、官方 secure-use review。

仍待：

- formal migration policy（schema version bump／migration path）。
- AuditLog persistence scope、durable append-only storage、actor／request id。
- dynamic `innerHTML` 對 provider／user input 的 safe DOM boundary。
- secret scanning、code scanning、dependency review policy。

## Phase 4 — Test hardening（P1）

- risk integration tests
- preview / confirm stale-state tests
- kill-switch persistence／scope tests
- order state-machine tests
- backtest golden／property tests
- localStorage corruption tests
- browser smoke：tabs、screener、backtest、rejected order、confirm、kill switch、keyboard、responsive
- accessibility：contrast、focus、dialog、table semantics、reduced motion

## Phase 5 — Architecture cleanup（P1/P2）

只在 tests 保護後做：

- injectable Clock／IdGenerator
- `MarketDataAdapter` port
- `PaperBroker`／future Broker adapter separation
- `OrderService` commit boundary
- domain error classes
- reduce `app.js` orchestration size

不因重構而引入 React、bundler、TypeScript 或大型 runtime dependency。

## Phase 6 — UI/UX benchmark P0/P1/P2（P2）

依 `docs/UI_UX_BENCHMARK.md`：

- P0：清除 inline styles、tokens、KPI hierarchy、contrast、global paper status。
- P1：canvas sizing、table states、empty/loading/error、sticky headers。
- P2：motion tokens、purposeful transitions、modal／order states、responsive chrome。

UI 改動必須保留 domain semantics，不得用視覺 fallback 掩蓋風控或資料錯誤。

## Phase 7 — Adapter readiness（P1/P2）

先 fake contract，再考慮 paper provider：

- Fugle／Shioaji：TW data／simulation assumptions、rate limit、corporate actions。
- Alpaca：paper endpoint、paper/live separation。
- IBKR：paper semantics、order status、reconciliation。

仍不得自動進 live trading。

## Phase 8 — Performance／observability（P2）

先 baseline：

- JS／CSS／HTML size
- first load
- render／resize time
- backtest runtime at 250／10k／100k bars
- chart redraw

再決定 incremental indicators、memoization、requestAnimationFrame 或 metrics；不先猜。

## Phase 9 — Production-readiness study（不等於 production deploy）

只做 gap analysis：auth、MFA、secrets、multi-tenant、persistent audit、reconciliation、legal／data licensing、incident response。live broker、正式部署、branch protection 仍需明確決策。
