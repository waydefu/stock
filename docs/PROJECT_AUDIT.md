# Project Audit

## Baseline

- Repository：`waydefu/stock`
- HEAD：`604fbba60882a0c79062443ecbca864a97a5ca7b`
- Branch：`main`
- Working tree：clean at audit refresh
- Runtime：Node.js 24 local；GitHub Actions `Quality` latest observed success on the same HEAD
- Product boundary：research／education／paper-only prototype；no live broker path

## Current checkpoint（歷史快照；現況以 `docs/PROJECT_STATUS.md` 為準）

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

## Audit snapshot 2026-09-14（`1d36fe5`，全案稽核；現況以 `docs/PROJECT_STATUS.md` 為準）

- HEAD：`1d36fe5cdd70dc27380931dca91377225e1db3a9`（PR#27 squash-merge）；open PR：#28（`feat/phase7c-live-ui`）
- 範圍：`js/`、`server/`、`scripts/`、`tests/`、`.github/`、`docs/` 全讀；正式站（Pages）與 Render proxy 各做非破壞性實測。
- 未做：壓力／DoS 測試（R-024、R-025 的濫用情境由程式碼推導，不對公開服務施壓）；完整 WCAG 手動稽核；Fugle 條款法律判讀。
- 對應：風險列 `docs/RISK_REGISTER.md` R-023～R-032；修正計畫 `docs/FUTURE_PLAN.md`「稽核後收斂 Track A–D」。
- 以下 F-／G- 編號只在本 snapshot 內使用；追蹤以 R- 編號為準。

### Verification evidence（2026-09-14）

| Command / evidence | Result | Classification |
|---|---|---|
| `npm test`（Windows 10、Node 24.15.0） | 260 tests：259 pass／1 fail（`tests/proxy-runtime.test.js:28` SIGTERM exit code 為 `null`，Windows 限定，見 F-10） | Confirmed |
| GitHub Actions `Quality`（ubuntu，`1d36fe5` push） | success | Confirmed |
| `check:syntax`／`check:static`／`check:ui`／`score:ui` | exit 0／27 files／34 pass 0 warn 0 fail／100/100 | Confirmed |
| `check:status`（main push） | PASS（非 PR 事件直接通過） | Confirmed |
| 正式站瀏覽器：Trader、TW 2330 零股 10 股預覽（台北 16:45） | 預填 `1148.88` → `INVALID_TICK`；改 `1000` → `REFERENCE_PRICE_REQUIRED` | Confirmed（production） |
| 以 repo 模組重現 UI 組單路徑（`PaperBroker`＋`RiskEngine`＋`executePaperOrder`，台北 10:00） | 不帶 `referencePrice` → preview 與 confirm 皆 `REFERENCE_PRICE_REQUIRED`；帶上即 `APPROVED` | Confirmed |
| 6 檔台股模擬報價 `validateTick` | 6/6 `INVALID_TICK` | Confirmed |
| 無 Origin 的 `curl GET /api/market/quote?symbol=2330`（Render proxy） | 200＋真實 Fugle envelope | Confirmed（production） |
| 漲跌停窮舉：0–3,000 元共 4,000 個合法參考價，以整數分精確算法對照 `calculatePriceLimits` | 21 mismatch（1.10–10.50 元） | Confirmed |
| `gh api repos/waydefu/stock/branches/main/protection` | 404 Branch not protected | Confirmed |
| `git log -p --all` 疑似秘密掃描 | 只見測試假值（sentinel／dummy key） | Confirmed |

### Findings（2026-09-14）

#### P1

- **F-01（R-023）台股紙上下單在 UI 永遠被拒。** `js/app.js:626` `previewOrder()` 組單不帶 `referencePrice`，`js/risk.js:52-55` 對 TW 強制要求；模擬報價（`js/data.js:103-108`）不對齊跳動點，預填價先被 `INVALID_TICK` 擋下。FUTURE_PLAN Phase 3 步驟 4 已寫「UI intent 帶 reference price」，PR#12 未落實。引擎測試自帶參考價、`check:ui`／`score:ui` 為原始碼比對、PR#24 瀏覽器驗收未涵蓋下單，因此在全綠下漏網。
- **F-02（R-024）公開 proxy 無存取控制，且限流全體共用。** `server/market-proxy.js:45-65` 單一 process 共用 120 req／60s，不分來源；每個放行請求上游最多 3 attempts。ADR-006 與 `docs/PROVIDER_READINESS.md` 已把「公開前加 anti-abuse／重審授權」列為前提，Pages＋Render 公開後條件已成立。
- **F-03（R-025）串流名額可被耗盡，訂閱錯誤不回傳。** `server/fugle-stream-manager.js:109-110` 全域 50 SSE／20 key，無 per-client 上限；`:262-264` 非認證 upstream error 只記 log；`:254` 需全部 key acked 才進 LIVE。`mapUpstreamError()` 的 `STREAM_SUBSCRIBE_FAILED` 對應（`tests/stream-contract.test.js:266`）未被 manager 使用。
- **F-04（R-026）台股成本缺證券交易稅與最低手續費。** `js/backtest.js:85`、`js/research.js:38,63` 僅 0.1425% 雙邊手續費＋滑價；repo 內無交易稅實作。現股一次來回手續費＋稅約 0.585%，模型只計 0.285%。

#### P2

- **F-05（R-027）** 手動斷路器不持久化：`js/risk.js:23-24` 為記憶體狀態，reload 即解除；牴觸 `GOVERNANCE.md` 安全門檻 2。
- **F-06（R-028）** 漲跌停浮點取整：`js/market-rules.js:136-137`。例：參考價 1.10 跌停得 1.00（應 0.99）；1.90 漲停得 2.08（應 2.09）。
- **F-07（R-029）** ETF／受益憑證套用股票跳動點（`js/market-rules.js:13-20`）；`validateOrderTypeInSession()`（`:194-201`）不看 lot。
- **F-08（R-030）** `probeStale()`（`server/fugle-stream-manager.js:422-429`）只在測試呼叫，正式流程未排程；R-022 所列 STALE 緩解尚未接線。
- **F-09（R-031）** `js/research.js:153-155` 不論是否真的成交都更新 `target`；配置為 0 或股數取整為 0 時，策略狀態與持倉脫鉤。

#### P3

- **F-10** Windows 相容：`tests/proxy-runtime.test.js:26-28`（SIGTERM exit code）；`package.json` 的 `check:syntax` 依賴 find／xargs。
- **F-11** `riskFreeRate` 以每期相減（`js/backtest.js:201`、`js/research.js:248`），UI 以年化 % 顯示（`js/app.js:290`）；預設 0，暫無影響。
- **F-12** 冪等窗口：`js/paper.js:233` 訂單截斷為 100 筆，重複 `clientOrderId` 只比對最近 100 筆。
- **F-13** 日損分母：`js/risk.js:75` 用當下 equity，snapshot 另提供 `dailyLossReferenceEquity`（session 開盤 equity）；語義不一致（結果偏保守）。
- **F-14** `server/market-proxy.js:335-341` 第二個逾時計時器未清除；`:401` latency 用 `Date.now()` 而非注入 clock。

#### Governance／docs

- **G-01（R-032）** `docs/PROJECT_STATUS.md` 在 main 上過期（仍寫 `ca6a554`、「本分支 feat/phase7c-server-bridge」）；`scripts/check-status.js:43-56` 在 main push 直接 PASS，PR 階段只檢查檔案是否被改。本 PR 同步至 `1d36fe5`，結構問題見 Track C3。
- **G-02** `README.md:6`「全部行情都是本機種子生成的模擬資料」、`:51`「107 tests」已過期；架構清單缺 `server/`、Fugle／stream 模組。
- **G-03（R-032）** 無 browser E2E：閘門量的是原始碼樣式，F-01 在 `score:ui` 100/100 下存活。R-020 的 Chromium 崩潰是本機環境限制，GitHub ubuntu runner 不受影響。
- **G-04** main 無 branch protection／rulesets，push 即部署 Pages；57 個 commit 中 30 個作者為 `root <root@localhost.localdomain>`；17 條已合併分支未刪除。
- **G-05** 文件漂移：FUTURE_PLAN Phase 3／4／5 已由 PR#12／#13／#14 合併但未標完成（本 PR 補標）；AUDIT／ROADMAP／FUTURE_PLAN／DELIVERY_REPORT／STATUS 範圍重疊。

### Confirmed strengths（維持，不回退）

- Secret custody：`FUGLE_API_KEY` 只在 runtime env；缺 key fail-fast（`server/start-market-proxy.js:18-20`）；log redaction 以 sentinel 測試鎖住；Pages 只注入公開 URL。
- CI supply chain：Actions full-SHA pin、workflow `permissions: contents: read`、Dependabot。
- No look-ahead：bar-close signal＋next-bar-open fill；`rollingHigh` 不含當根（`js/data.js:145-153`）；研究引擎每根只給 `0..i` 切片（`js/research.js:146-150`）。
- 零 runtime 依賴、穩定錯誤碼、可注入 clock／id／transport；promotion FAIL、CORS≠auth、paper-only 皆誠實揭露。

### Verdict（2026-09-14）

資料鏈與研究框架的可信度高於 2026-09-11 checkpoint；但 TW 紙上交易主流程在 production 不可用（R-023），公開 proxy 的濫用與授權風險已從「部署前提」變成「現況」（R-024、R-025）。Track A 驗收前，不應合併把瀏覽器流量導向 stream 端點的 PR#28，也不應把研究 gate 結果當成台股實際成本下的結論（R-026）。

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
