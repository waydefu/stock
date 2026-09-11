# Project Roadmap

## Status

Current 狀態唯一來源：`docs/PROJECT_STATUS.md`（HEAD／tests／gates／open PR／缺口）。
本文件只管路線與範圍，不再重複 current 數字。

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

仍待：non-zero fee models（預設 prototype 仍為 zero-fee paper，見 R-018）。risk-free／minimum-sample metric policy 已由 PR#3 落地：`riskFreeRate` 顯式（預設 0）、`minSharpeSamples` 不足時標「樣本不足」不採信。

Phase 1 additions：

- backtest peak drawdown／periodsPerYear／malformed bar validation completed with golden tests。
- `AccountSnapshot` now defines cash／marketValue／equity、realized／unrealized／total PnL、daily PnL、fees and invariants。
- TW／US `MarketRules` contract added; `MarketSessionClock` uses market-local timezone while calendar remains simplified-weekday。
- `MarketRules` TW partial／US simplified contract；shared lot validation 已接 RiskEngine／PaperBroker／UI intent。
- Sharpe 小樣本守衛＋risk-free 顯式化（PR#3）：樣本不足顯示「樣本不足」，assumptions 記錄 `riskFreeRate`／`minSharpeSamples`。
- `MarketDataAdapter` port 已落地（PR#6）：UI／回測經 `SimulatedAdapter` 取數，live adapter 照同介面替換。
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
- **ADR-005 persistence strategy defined**: schema version guard + PERSISTENCE_RESET audit event, single-tab prototype scope documented.

仍待：

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

只在 tests 保護後做（`MarketDataAdapter` port、`OrderService` commit boundary、domain error classes 已於 PR#5／#6 落地）：

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

已完成 P1（advisory-only、不碰決策路徑）：

- 下單票試算 `orderEstimate`（PR#7；`role=status` 即時試算，決策仍只走 preview→RiskEngine→confirm revalidation）。
- K 線 last-price 虛線＋標籤（PR#7；stub canvas 測試鎖住）。
- KPI 層次（PR#7）：淨值 28px hero，其餘 22px。
- 自選清單本機持久化（`js/favorites.js`，寫入失敗不影響交易主流程）。

仍待 P1/P2（誠實缺口）：

- 完整 WCAG 人工 audit、viewport 瀏覽器幾何實測（重疊／裁切／橫向捲動）。
- equity 曲線 hover（主圖 crosshair 已做，權益曲線 defer）。

已完成 P1（`feat/ui-p1-remainder`，`check-ui` 25/25）：

- loading／permission states：`statePanel` 五態＋`.state-loading` spinner＋`.state-permission` 下一步文案；權限拒絕走元件（`app.js:445`）。
- crosshair／tooltip：主圖 `candleHoverAt` 純幾何 helper＋canvas OHLC 提示（`charts.js:88`），鍵盤使用者由表格取同資料。
- 靜態初始 tbody＋noscript：JS 載入失敗不留白（`static-initial-states` 閘）。
- 下單 ack 過渡：`.order-ack`（reduced-motion 全關）。
- 響應式降級規則文件化（`docs/UI_UX.md`）；benchmark 同 rubric 重評 7.9/10（`UI_UX_BENCHMARK.md`，舊 2.0 保留）。

## Phase 7 — Adapter readiness（P1/P2）

Phase 7A（`feat/adapter-readiness`，本輪）：boundary 先行，不接真 API。

- provider-neutral contracts（`js/market-data-contract.js`）：capability、envelope、quote/bars 正規化、freshness（FRESH／STALE／UNKNOWN）、MarketDataError 穩定碼、bounded retry＋backoff、Retry-After 優先、injected transport。
- deterministic fixture（`js/fixture-provider.js`）：401／429／500／timeout／重複／亂序／stale／缺欄／schema drift 全劇本；`selectAdapter` 無靜默退回；`assertBrowserSafeConfig` 鎖瀏覽器側秘密。
- SimulatedAdapter legacy 形狀零變更，另附 envelopes／describe／capabilities／status。
- UI 最小接線：machine-readable dataKind／status、研究假設來源標籤、point-in-time／adjustment unknown 誠實標記。
- readiness matrix＋首選 Fugle（trusted proxy 架構）：`docs/PROVIDER_READINESS.md`（官方來源，2026-09-11 查驗）。

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

## Phase 10 — Quant research framework 第一輪（完成，PR#9）

已落地：Strategy／Signal 契約（`js/strategy.js`）、研究基準庫（`js/alpha.js`：cash／buyHold／multi-horizon trend，皆有 hypothesis＋warmup）、Portfolio 層（`js/portfolio.js`：fixed-fraction／full-notional／capped vol overlay／hard limits）、研究引擎（`js/research.js`：分層回測、IS/OOS、walk-forward、cost stress、parameter surface、6-check promotion gate）、策略中心 UI（benchmark 同場、gate、provenance、robustness，不自動晉升）。

誠實結果：trend 在 2330 模擬資料 gate FAIL；框架按設計拒絕弱證據。

仍待（皆需先有資料／證據才動工）：value／quality interface（缺 point-in-time fundamentals）、pairs／regime、多標的 universe、TWAP／VWAP／participation execution（缺 intraday granularity）、FUTURE Phase 2 費用可插拔證明、瀏覽器 4 viewport 截圖（待 Chromium 環境修復，見 R-020）。
