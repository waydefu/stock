# Project Audit

## Baseline

- Repository：`waydefu/stock`
- HEAD：`604fbba60882a0c79062443ecbca864a97a5ca7b`
- Branch：`main`
- Working tree：clean at audit refresh
- Runtime：Node.js 24 local；GitHub Actions `Quality` latest observed success on the same HEAD
- Product boundary：research／education／paper-only prototype；no live broker path

## Current checkpoint

- HEAD：`f07b8d3bad15f2f182dfe7f64251350cf4c3a2aa`
- Branch：`main`；working tree clean；PR#16（Phase 7A）已 squash-merge
- Local verification：`check:static` 27 files、`check:syntax` exit 0、`check:ui` 28 passed／0 failed、`npm test` 142 passed／0 failed、`git diff --check` exit 0
- Merged since `604fbba`（摘要）：PR#10 docs 對齊、PR#11 FeeModel、PR#12 MarketRules（tick／limit／session＋RiskEngine 接線）、PR#13 ADR-005、PR#14 UI P1（benchmark 7.9/10）＋Pages 上線、PR#15 手機版、PR#16 7A adapter boundary
- Phase 7B1（Fugle REST＋proxy）進行中，分支 `feat/fugle-rest-adapter`，未 merge
- Remote Quality：run `34447357364`，same SHA，success
- Merged since `df0366a`：PR#9 quant research engine＋professional trading workstation（7 原子提交：strategy/signal contract、research baselines＋multi-horizon trend、portfolio allocators＋vol overlay＋hard limits、IS/OOS＋walk-forward＋cost stress＋promotion gate、workstation visual contract、strategy research workspace、anti-template gates＋ui-score；2026-09-10 UTC squash-merge）
- Baseline scores below are historical；本輪尚未重新執行 UI／engineering rubric，因此不把修復直接換算成新分數。
- Current fixed／improved：AccountSnapshot accounting contract、realized／unrealized PnL、zero-fee FeeModel、market-local session clock、shared TW/US lot validation、simplified calendar boundary used by deterministic data、corporate-action schema contract、explicit immediate execution mode、OPEN state transitions、stable order error categories、persisted versioned session audit、corrupt order reset、1,000-intent deterministic accounting fuzz、core tab／tabpanel／dialog keyboard semantics、precomputed backtest signal arrays、actionable empty/error state blocks；本輪新增：Sharpe min-sample guard＋explicit risk-free、programmatic UI gate（16 checks）、`MarketDataAdapter` port（`SimulatedAdapter`）、自選持久化、下單票 advisory 試算、K 線 last-price 線、KPI hero 層次、Actions v7 SHA pin。
- Remaining gates：exchange holiday/session hours/tick policy、corporate-action adjustment data、matching fills、multi-tab semantics、loading／permission accessibility states、full WCAG audit、server-grade tamper-resistant audit。
- 本輪新增（evidence 見 `docs/DELIVERY_REPORT.md`）：Strategy／Signal 契約＋lifecycle、Cash／Buy&Hold／multi-horizon trend 研究基準、Portfolio allocator＋capped vol overlay＋hard limits、分層研究引擎（IS/OOS＋walk-forward＋cost stress＋parameter surface＋6-check promotion gate）、workstation 視覺契約（spacing scale／8px radius／24px target／鍵盤可達 tiles）、策略中心（benchmark 同場＋gate＋provenance＋robustness）、anti-template gates（check-ui 21）＋ui-score 100/100。
- 本輪誠實結果：multi-horizon trend 在 2330 模擬資料上 IS −11,888／OOS 零交易→promotion gate FAIL（OOS 期望為負）；buyHold IS +206k／OOS −20k。框架正確拒絕弱證據，不自動晉升任何策略。
- 本輪未做（deferred with reason）：瀏覽器 4 viewport 截圖——本機 Chromium GPU 行程必崩（`GPU process isn't usable`），改以真實資料端到端＋ID 交叉引用＋ui-score 靜態證據替代；value／quality（缺 point-in-time fundamentals，只缺 interface 未建）、pairs／regime、多標的 universe、TWAP／VWAP execution（缺 intraday granularity）；legacy `runBacktest` 融合迴圈保留為相容路徑（見 R-021）。

## Verification evidence

| Command / evidence | Result | Classification |
|---|---:|---|
| `npm run check:static` | exit 0 | Confirmed |
| `npm run check:syntax` | exit 0 | Confirmed |
| `npm test` | 18 passed, 0 failed | Confirmed |
| `git diff --check` | exit 0 | Confirmed |
| Browser CDP smoke | page, tabs, backtest, paper order, console errors `[]` | Confirmed; narrow scenario only |
| GitHub Actions `Quality` | success, annotations 0 | Confirmed |

## Dimension scores

分數是目前 prototype 的工程成熟度，不是投資品質，也不是 production certification。每一格都要和下方 evidence 對讀。

| Dimension | Score / 10 | Verdict |
|---|---:|---|
| Product correctness | 5 | 紙上範圍清楚；交易／資料語義仍簡化 |
| Market-data correctness | 2 | 固定 seed 模擬資料可重現，但不是 provider data，市場規則簡化 |
| Backtest correctness | 4 | 下一根開盤、成本與滑價有實作；drawdown／Sharpe／validation 尚未完整 |
| Paper-trading realism | 2 | 目前 placeOrder 直接 filled，沒有 open／partial／cancel lifecycle |
| Risk controls | 3 | 有 cap／kill switch／role；dailyPnl 未由 snapshot 提供，confirm 未重新過風控 |
| Architecture | 5 | domain modules 已分檔；app.js 仍集中 orchestration 與 HTML rendering |
| State management | 2 | paper localStorage 無 schema version／migration；audit 只在 memory |
| Security | 4 | 無網路／無秘密是優點；dynamic innerHTML、Actions 未 pin SHA、CSV edge cases 仍待查 |
| Privacy / secret handling | 6 | README／CI 明確禁止秘密；沒有 server boundary，無法提供 production isolation |
| Testing | 3 | 18 個 deterministic unit tests；缺 integration、state-machine、property、a11y、E2E |
| CI/CD | 4 | syntax／test／static／HTTP smoke；缺 action pinning、security scan、dependency policy |
| Reliability | 3 | 純靜態、低依賴；缺 runtime error boundary、provider outage、retry、stale data |
| Observability | 2 | audit 只在 memory，沒有 persistent event id、source freshness、metrics |
| Performance | 3 | 小資料量可用；backtest 每根 bar 重算指標，可能 O(n²) |
| Accessibility | 3 | 有 `focus-visible` 與 aria 基礎；對比、table semantics、dialog focus、canvas alternative 不完整 |
| Responsive UX | 3 | 有兩個 breakpoint；inline width、canvas、dense tables 尚未做降級規則 |
| Design-system integrity | 1 | 55 個 HTML inline style，tokens 無法成為單一真相 |
| Trading UX | 3 | 頁籤與 paper preview 存在；沒有完整 order state／stale confirmation／empty state |
| Documentation | 6 | 文件多且有來源；部分文件仍描述候選 adapter／prototype，而非實際 contract |
| Governance | 5 | 規則文件與 PR template 有；branch protection、required checks 尚未啟用 |
| Developer experience | 6 | 零 runtime dependency、單命令測試、CI 清楚；缺 architecture ADR／integration harness |
| Future broker readiness | 2 | adapter 概念有；缺 order event、reconciliation、clock、idempotency contract |

## Confirmed findings

### P0 — financial / order safety

1. `PaperBroker.snapshot()` 不回傳 `dailyPnl`。`RiskEngine` 使用 `account.dailyPnl ?? 0`，因此正常 UI path 的 daily-loss circuit breaker 目前看不到實際日損。現有 test 是手工注入 `dailyPnl`，不是 integration evidence。
2. `previewOrder()` 取得 account snapshot 並通過風控後，`confirmOrder()` 只呼叫 `PaperBroker.placeOrder()`；confirm boundary 沒有重新讀 account、kill switch、risk config、cash、position、price 或 quantity。這是 confirmed TOCTOU gap。

### P1 — correctness / audit / security

3. `PaperBroker.placeOrder()` 立即修改現金／持倉並回傳 `status: "filled"`；沒有 deterministic order lifecycle、partial fill、cancel、expiry 或 fill event。
4. `AuditLog` 只存在 memory；reload 後消失。class 仍提供 `clear()`；文件使用 append-only 語氣，但 implementation 沒有 persistent append-only boundary。
5. `PaperBroker` 讀取 localStorage 後只做 shallow merge，沒有 schema version、migration 或完整 shape validation；localStorage 是使用者可修改的 untrusted input。
6. order 沒有 idempotency enforcement；`clientId` 被記錄但不去重，重送 intent 可能產生多筆紙上成交。
7. `PaperBroker` order id 直接使用 `Date.now()`；未使用 injectable clock，跨程序 deterministic replay 不完整。
8. `runBacktest()` 每根 bar 重新建立 closes 與整條 indicator array；小資料正常，但資料量放大後有 O(n²) 風險。
9. `maxDrawdownPct` 以 initial capital 做 denominator，沒有使用當下 equity peak；metric semantics 需要 golden test 與決策。
10. Sharpe 固定 `sqrt(252)`，沒有 timeframe／risk-free／sample policy；目前只適合被標成簡化 daily metric。
11. `innerHTML` 大量組合 dynamic values。現在來源是靜態 seed，尚未形成外部輸入漏洞；未來接 provider／user input 前必須改 safe DOM API 或嚴格 escape。
12. CSV cell escape 處理逗號／引號／換行，但 event／details 的 spreadsheet formula injection 尚未有 regression test。
13. GitHub Actions 使用 tag `@v5`，不是 immutable SHA；repo 目前沒有 Dependabot、dependency review、code scanning 或 secret scanning workflow。

### P2 — product / UX / maintainability

14. 設計系統被 55 個 inline styles 繞過，造成 typography／spacing／color 無法集中治理。
15. `canvas.chart` 高度由 JS 事後寫入，CSS 沒有 stable aspect/min-height；no-data／error／tooltip／crosshair 尚未完整。
16. table 沒 sticky header、sort state、scope semantics；tbody 在 JS 失敗時為空白。
17. modal 沒有明確 focus trap、Escape close、focus restore；tabs 沒有完整 `aria-controls`／hidden semantics。
18. 角色切換是 UI 狀態，不是 authorization；文件有說明，但容易被使用者誤解成實際 RBAC。

## Needs verification

- `dailyPnl` 的產品定義：realized-only、realized + unrealized，或 session-open equity delta。
- `maxDrawdownPct` 與 Sharpe 的正式 metric contract。
- 台股 market rules：calendar、tick size、price limit、odd-lot、corporate actions。
- 真實資料 adapter 的 rate limit、stale policy、provider timestamp 與 adjustment mode。
- GitHub repo 是否要啟用 branch protection、required `Quality`、Dependabot／security features。

## Historical / already fixed

- Node 20 action runtime annotation 已改為 `checkout@v5`／`setup-node@v5`、Node 24、明確關閉 package-manager cache；目前 CI annotations 為 0。
- README 的 tab 數、MA20/50、`npm test`、PaperBroker 邊界已與目前實作同步。

## Immediate verdict

目前不能宣稱「金融邏輯已完成」或「ready for live broker」。Phase 1 必須先修 P0 daily-PnL wiring 與 confirm-boundary revalidation，再處理 order lifecycle、metrics golden tests 與 persistence；UI 大改延後。
