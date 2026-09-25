# 未來計劃書：waydefu/stock 收斂到高品質股票研究系統

> 定位：research／education／paper-only prototype，不接真實券商。
> 寫法：每個 Phase 都可照跑——前置、指令、驗收、證據四件齊全才算完成。
> 規模以 S／M／L 相對標示，不虛構工時；牽涉外部規則的一律先查官方來源再實作。

## 0. 執行約定（所有 Phase 共用）

### 0.1 鐵律

1. `PAPER / SIMULATION` 是唯一內建執行模式；不新增 live 下單路徑、不碰秘密。
2. 先證據後修改：每個改動先有 failing test 或 failing gate，再修。
3. 一個 logical change 一個 commit；一個 Phase 可多個 PR，但不混 domain 與 UI。
4. `main` 只經 PR 整合；Merge 由維護者決定，agent 停在綠燈 PR。
5. CI 失敗修根因，不 skip／降門檻。CI workflow 本身的變更另走決策（見 Phase 7）。

### 0.2 每次開工指令（貼上即跑）

```bash
cd /root/projects/股票
git fetch origin --prune
git status --short --branch
git rev-parse HEAD
npm run check:syntax && npm run check:static && npm run check:ui && npm test && git diff --check
gh run list --repo waydefu/stock --limit 3 --json databaseId,headSha,status,conclusion,workflowName --jq '.[]'
```

### 0.3 基線快照（2026-09-10，`main`）

- HEAD：`604fbba60882a0c79062443ecbca864a97a5ca7b`（PR#9 squash-merge）
- `npm test`：107 passed／0 failed；`check:static` 27 files；`check:syntax` exit 0；`git diff --check` exit 0
- Quality CI：`34447357364` success（對應同 SHA）
- UI 閘門：`npm run check:ui` 21 項全過；`npm run score:ui` 100/100 PASS（靜態可證部分）
- 已合併：PR#9（quant research engine＋workstation，7 原子提交）；open PR：無
- 風險登錄：`docs/RISK_REGISTER.md` R-001～R-021（R-008 已關閉；新增 R-019 誤讀風險、R-020 瀏覽器環境限制、R-021 legacy 相容路徑）；路線圖：`docs/PROJECT_ROADMAP.md`（新增 Phase 10）

---

## Phase 1 — 合併 PR#3 並同步文件（S）✅ 已完成（2026-09-09 UTC 合併）

目標：把 Sharpe 契約收尾正式落地，文件不再描述舊行為。

非目標：不動其他指標、不改 UI 版面。

前置：PR#3 Quality 綠燈（已於 `34396928921` success）。

步驟：

```bash
# 1. 維護者審查 PR#3（#3: fix/sharpe-sample-guard → main）後合併
gh pr view 3 --repo waydefu/stock
# 2. 合併後同步 main 並重跑全體驗證
git checkout main && git pull origin main
npm run check:syntax && npm run check:static && npm run check:ui && npm test && git diff --check
# 3. 另開 docs 分支同步 audit／roadmap／risk（R-008 註記 min-sample 已解）
git checkout -b docs/sharpe-checkpoint
# 編輯 docs/PROJECT_AUDIT.md（Current checkpoint）、docs/PROJECT_ROADMAP.md（Phase 1）、docs/RISK_REGISTER.md（R-008）
npm run check:static && git diff --check
git add docs/ && git commit -m "docs: record Sharpe sample-guard checkpoint" && git push -u origin docs/sharpe-checkpoint
gh pr create --repo waydefu/stock --base main --head docs/sharpe-checkpoint --title "docs: record Sharpe sample-guard checkpoint" --body "見 PR 範本"
```

驗收：

- [ ] `main` 含 minSharpeSamples／riskFreeRate 契約與測試
- [ ] 文件 HEAD／test count／CI run 三者一致
- [ ] R-008 狀態更新為「min-sample 已解；剩 risk-free 政策文件化」或關閉（見 Phase 2）

證據：合併 commit SHA、Quality run ID、`npm test` 69 passed 輸出（見 `docs/PROJECT_AUDIT.md` Current checkpoint；R-008 已關閉）。

---

## Phase 2 — 回測殘留收尾（S）✅ 已完成（2026-09-10 UTC，PR#11）

目標：關閉 R-008 與費用語義缺口，不留「以後再說」的指標。

對應風險：R-008（Sharpe）、R-018（費用／滑價語義）。

步驟：

```bash
git checkout -b feat/fee-model-proof
# 先寫 failing test → 實作 → 全綠
node --test tests/accounting.test.js
npm test
git add js/ tests/ docs/ && git diff --cached --check
git commit -m "test: prove pluggable FeeModel without changing paper default" && git push -u origin feat/fee-model-proof
gh pr create --repo waydefu/stock --base main --head feat/fee-model-proof --title "test: prove pluggable FeeModel without changing paper default" --body "見 PR 範本"
```

驗收：

- [x] R-008 可關閉（min-sample＋risk-free 皆有契約＋測試＋文件）
- [x] 預設 paper 行為零變更（既有現金數字測試全過）
- [x] `docs/ARCHITECTURE.md` 明確寫出 backtest-slip vs paper-fee 分工

證據：PR#11（`tests/fee-model.test.js` 4 測試通過、`js/paper.js:141` 修正 snapshot feeModel 讀取）、111 tests 綠、check:ui 21/21。

---

## Phase 3 — MarketRules：tick／price-limit／交易時段（M）✅ 已合併（2026-09-10 UTC，PR#12）

> 2026-09-14 稽核：步驟 4「UI intent 帶 reference price」未落實，台股紙上單在 UI 全數被拒，見 R-023／Track A1。

目標：把 `MarketRules` 從「lot＋時區」推進到「價格規則」，但只收錄查證過的規則。

對應風險：R-013。鐵律：不要 hard-code 未查證或會變動的金融規則；會變的加 `effectiveFrom`／`source`／`lastVerifiedAt`。

步驟：

```bash
git checkout -b feat/market-price-rules
# 1. 重查官方（每次實作前重查，不沿用舊引用內容）
#    TWSE 交易制度＋升降幅度＋零股＋營業日；US 維持 simplified 並承認 DST
# 2. 查到的每條規則先進 docs/RESEARCH_LEDGER.md，格式：
#    Claim / Source / Authority / Accessed / Applies to / Time-sensitive / Implementation impact
# 3. 先寫 failing tests（tick 非法→INVALID_TICK，超漲跌幅→PRICE_LIMIT），再實作 validatePrice(market, price, reference)
# 4. 接入 RiskEngine（preview 即拒）與 PaperBroker（commit 邊界再拒），UI intent 帶 reference price
node --test tests/market-rules.test.js
npm test && npm run check:ui && git diff --check
git add js/ tests/ docs/ && git commit -m "feat: enforce sourced tick and price-limit rules" && git push -u origin feat/market-price-rules
gh pr create --repo waydefu/stock --base main --head feat/market-price-rules --title "feat: enforce sourced tick and price-limit rules" --body "見 PR 範本（含來源 URL 與 effectiveFrom）"
```

驗收：

- [ ] 每條新規則在 research ledger 有主來源＋查驗日期
- [ ] 未查證的 tick 段／例外寫成明確缺口，不編數字
- [ ] preview 與 confirm 拒絕碼一致（同 code）
- [ ] US 仍標 `simplified-prototype`，不假裝 venue 完整

決策點：tick schedule 全表是否一次收錄（建議分兩批：先常用價格段，例外另案）。

---

## Phase 4 — 儲存遷移政策＋多 tab 範圍 ADR（S）✅ 已合併（2026-09-10 UTC，PR#13）

目標：關閉 R-005／R-017 的模糊地帶，用 ADR 定案，不加 database。

對應風險：R-005（migration）、R-006／R-017（audit／multi-tab scope）。

步驟：

```bash
git checkout -b docs/storage-scope-adr
# 1. 新增 docs/ADR-005-persistence-strategy.md（沿用 ADR-001～004 編號習慣）：
#    A memory-only / B localStorage persisted（現狀）/ C IndexedDB / D 未來後端 append-only
#    就 security／tamperability／persistence／complexity／migration 五維打分，結論：維持 B＋版本重置政策
# 2. 把政策寫成測試：schemaVersion 未知→安全重置＋audit 事件 PERSISTENCE_RESET（不靜默丟資料）
# 3. multi-tab：文件定為 single-tab prototype；若做 storage-event 同步只做 UX 提示，不做安全控制
npm test && git diff --check
git add docs/ tests/ && git commit -m "docs: decide persistence and multi-tab scope" && git push -u origin docs/storage-scope-adr
gh pr create --repo waydefu/stock --base main --head docs/storage-scope-adr --title "docs: decide persistence and multi-tab scope" --body "見 PR 範本"
```

驗收：

- [ ] ADR-005 存在且被 `docs/PROJECT_ROADMAP.md` 引用
- [ ] 未知 schema 版本有測試覆蓋的安全重置路徑
- [ ] 文件不再出現 durable／tamper-proof 等誤導字眼（全文 grep 驗證）

```bash
grep -rn "tamper-proof\|append-only audit\|durable audit" docs/ README.md index.html js/ | grep -v "不是\|不\|deferred\|server-grade" || true
```

---

## Phase 5 — UI P1 剩餘＋benchmark 重評（M）✅ 已合併（2026-09-10 UTC，PR#14；benchmark 7.9/10）

目標：補完使用者可感知的狀態與層次，然後用同一 rubric 重打分（不自己加分）。

對應風險：R-015／R-016 殘留。範圍：loading／permission states、KPI hierarchy、responsive 降級規則、crosshair／tooltip、order acknowledgement motion；dialog／tabs 已完成，不重做。

步驟：

```bash
git checkout -b feat/ui-p1-remainder
# 1. loading／permission：沿用 statePanel/stateRow（role=status），permission 用 state-permission 樣式＋下一步文案
# 2. 每加一種狀態就擴 scripts/check-ui.js（新檢查＋門檻），先紅後綠
# 3. 跑純程式閘門＋鍵盤／dialog browser smoke（沿用 /tmp/stock_browser_accessibility.py、states 腳本）
npm run check:ui && npm test
BU_CDP_URL=http://127.0.0.1:9222 browser-use < /tmp/stock_browser_accessibility.py
git add index.html css/styles.css js/app.js scripts/check-ui.js && git diff --cached --check
git commit -m "feat: complete loading and permission states" && git push -u origin feat/ui-p1-remainder
gh pr create --repo waydefu/stock --base main --head feat/ui-p1-remainder --title "feat: complete loading and permission states" --body "見 PR 範本"
```

Benchmark 重評（獨立小 PR，先讀 `docs/UI_UX_BENCHMARK.md` 同一 rubric）：

- [ ] 同一 8 維度逐項給分，每分附 evidence（`check-ui` 輸出、browser 輸出、檔案行號）
- [ ] 分數用加權公式重算並貼出算式，不只寫總分
- [ ] 舊 2.0 評分保留為歷史，新分數另段呈現，不改寫歷史

---

## Phase 6 — 可觀測性基線（S）

目標：先量測再談優化；不引入 telemetry SDK。

步驟：

```bash
git checkout -b feat/observability-baseline
# 1. 量測並記錄（本機 Node 24＋Chromium 同環境，註明方法）：
#    - JS／CSS／HTML bytes（wc -c）
#    - 靜態首屏載入（python http.server＋curl 時間，3 次取中位數）
#    - chart redraw（resize 前後 performance.now，3 次）
# 2. structured error logging：統一 error code＋safe message＋recovery action 格式（沿用 ORDER_ERROR_CODE 習慣）
# 3. data-source state：dashboard 顯示 source／freshness／stale（只有模擬源也要顯示，不留白）
npm test && npm run check:ui && git diff --check
git add docs/ js/ && git commit -m "feat: record observability baseline" && git push -u origin feat/observability-baseline
gh pr create --repo waydefu/stock --base main --head feat/observability-baseline --title "feat: record observability baseline" --body "見 PR 範本（含三次量測原始值）"
```

驗收：每個數字有方法、環境、次數、原始值；lab≠field 在文件分開標示。

---

## Phase 7 — Broker 就緒差距分析＋治理加固（S，全為決策項）

目標：只輸出差距分析與決策清單，不實作 live。

A. Broker gap（文件 PR，不寫 adapter code）：

- local intent→ack→broker id→status→fills→reconciliation 的 contract 表（現狀：只有前兩步）
- paper≠live 差異表（撮合、延遲滑價、queue、費用），引用 Alpaca／IBKR／Shioaji／Fugle 官方 paper 文件
- 真實接線前置清單：服務端認證、MFA、秘密管理、訂單 reconciliation、風控、法遵、正式環境驗證

B. 治理加固（全部要明確批准才做，逐項開 PR）：

```bash
# 1. check-ui 納入 CI（.github/workflows/quality.yml 加一步；屬 CI 門檻變更，需批准）
# 2. branch protection＋required Quality（repo 設定，需批准，不由 agent 開）
# 3. Dependabot #1／#2 大版升級審查（先在 PR 跑全綠＋行為無變更才合併）
# 4. code scanning／secret scanning 評估（先文件，後開關）
```

驗收：每個決策項有「批准人／日期／理由」欄位；未批准的不做。

---

## 稽核後收斂：Track A–D（2026-09-14 起）

> 來源：`docs/PROJECT_AUDIT.md`「Audit snapshot 2026-09-14」；風險：`docs/RISK_REGISTER.md` R-023～R-032。
> 以字母編號，避免與 `docs/PROJECT_ROADMAP.md` 的 Phase 編號（7A／7B／7C、8、9、10）衝突。
> 順序硬性：前一 Track 驗收未過，不開下一 Track；Track D 逐項決策。規模沿用 S／M／L 相對標示。

### 基線快照（2026-09-14，`main`）

- HEAD：`1d36fe5cdd70dc27380931dca91377225e1db3a9`（PR#27 squash-merge）；open PR：#28（Live UI）
- Quality（ubuntu，同 SHA）success；本機 Windows `npm test` 259/260（Windows 限定失敗，見 B4）；`check:ui` 34/34；`score:ui` 100/100
- Production 實測：台股紙上下單 0% 可成交（R-023）；無 Origin 的 curl 可取真實 Fugle 報價（R-024）
- 風險登錄新增 R-023～R-032（P1 ×4、P2 ×6）

---

### Track A — 止血（下一可執行階段）

> **現況（2026-09-25）**：Phase 7C／PR#28 已上 main。下一個可合併的程式 PR＝**A1**（R-023）。

目標：讓 production 主流程可用，並在更多流量進來前收掉公開 proxy 的濫用面。

對應風險：R-023、R-024、R-025；R-032（文件同步部分）。

#### A1 台股下單流程（S）

```bash
git checkout -b fix/tw-order-reference-price origin/main
# 1. 先紅：新增 tests/order-flow.test.js，以「與 app.js 同一個純函式」組單 → risk.approveOrder → executePaperOrder
#    斷言：台北交易時段內 TW 零股（2330、合法 tick）→ APPROVED＋FILLED；模擬報價的預填價必須通過 validateTick
# 2. 抽出純函式 buildOrderCandidate({ market, symbol, side, qty, price, lot, quote })（新檔或 js/view.js 旁的無 DOM 模組）
#    referencePrice：模擬＝quote.prev（與漲跌幅同一來源）；Fugle 模式＝previousClose
# 3. 模擬報價在資料出口依 getTickSize() 取整一次（data.js／SimulatedAdapter），不在 UI 各處補
# 4. app.js previewOrder()／updateOrderPrice() 改用 builder；非交易時段仍回 MARKET_CLOSED（決策 D3 前不改語義）
node --test tests/order-flow.test.js tests/market-rules.test.js tests/risk-integration.test.js
npm run check:syntax && npm test && npm run check:static && npm run check:ui && git diff --check
```

驗收：

- [ ] 台北 09:00–13:25，正式站 Trader 預覽＋確認 TW 零股單 → 寫入紙上帳本
- [ ] 6 檔台股模擬報價 `validateTick` 全數 VALID（測試鎖住）
- [ ] preview 與 confirm 拒絕碼一致；US 路徑行為不變
- [ ] R-023 附修復證據

#### A2 proxy 與串流防濫用（M）

```bash
git checkout -b fix/proxy-abuse-limits origin/main
# 1. 先紅：
#    tests/market-proxy.test.js      同一 client 超額 → 429；另一 client 仍 200；同代碼 quote 在 TTL 內只打一次上游
#    tests/stream-sse-route.test.js  同一 client 超過 per-client SSE 上限 → 拒絕；另一 client 可連
#    tests/stream-manager.test.js    upstream error（symbol not found）→ 該 key 的 clients 收 STREAM_SUBSCRIBE_FAILED、key 釋放、其他 key 可達 LIVE
# 2. server/market-proxy.js：per-client token bucket
#    client key＝TRUST_PROXY=1 時取 X-Forwarded-For 第一段，否則 socket.remoteAddress（不信任任意 header）
#    quote 依代碼短 TTL 快取（3–5s，meta.cached=true）；每日上游呼叫預算，超過回 RATE_LIMITED 並記 log
# 3. server/fugle-stream-manager.js：per-client SSE 上限；非認證 upstream error 以 mapUpstreamError 路由到對應 key 並 detach；狀態改 per-key
npm test && npm run check:static && git diff --check
# 4. 部署後少量實測（不做壓力測試）：同一來源連續請求觸發 429；另一來源仍可取得 quote
```

驗收：

- [ ] 單一來源連打只影響自己
- [ ] 單一來源無法佔滿全域 SSE 名額
- [ ] 無效代碼訂閱在限定時間內收到錯誤並釋放名額
- [ ] 日誌不含 key（沿用 sentinel 測試）
- [ ] R-024、R-025 附修復證據；決策 D1 已記錄

#### A3 文件同步（S）

- `README.md`：定位改為「模擬資料＋可選 Fugle 真實行情（研究用）」；測試數改指向 `docs/PROJECT_STATUS.md`；架構清單補 `server/`、`js/fugle-proxy-adapter.js`、`js/stream-contract.js` 等
- `docs/RISK_REGISTER.md`：R-024 附 Fugle 條款確認結果

```bash
grep -n "107 tests\|全部行情都是本機種子" README.md || echo "README 已同步"
```

#### A4 Live UI 錯誤態補齊（S；PR#28 已於 2026-09-22 合併）

決策 D5 過期：#28 已在 A2 之前合併。後續改為在 A2 合併後，於 Live UI 補 `STREAM_SUBSCRIBE_FAILED`／`RATE_LIMITED` 可行動狀態（獨立小 PR，不重開 #28）。

---

### Track B — 金融正確性（第 2 週）

目標：讓回測、研究與紙上規則在台股實際成本與價格規則下成立。

對應風險：R-026、R-027、R-028、R-029、R-030、R-031。

#### B1 台股成本模型（M）

```bash
git checkout -b feat/tw-cost-model origin/main
# 1. 重查官方：證券交易稅（現股／當沖／ETF）、手續費率上限、最低手續費；逐條進 docs/RESEARCH_LEDGER.md
#    格式：Claim / Source / Authority / Accessed / Applies to / Time-sensitive / Implementation impact
# 2. 先紅：tests/fee-model.test.js 新增 TW 賣方交易稅、最低手續費、ETF 稅率 golden cases
# 3. js/accounting.js 新增 TW FeeModel（commissionRate、discount、minCommission、sellTaxRate by instrument）
#    backtest／research 成本改走 FeeModel；runCostStress 對全部成本項乘數
# 4. UI 假設面板列出稅率與最低手續費；可用 proxy 時重跑 npm run smoke:research:fugle，結論照實更新
npm test && npm run check:ui && git diff --check
```

驗收：golden cases 全過；假設面板顯示稅率；research 結論以新成本重記（promotion 結果若改變照實寫）。

決策點：paper broker 是否同步改用 TW FeeModel（R-018 目前為 zero-fee paper）。

#### B2 市場規則修正（S）

```bash
git checkout -b fix/market-rule-precision origin/main
# 1. 先紅：窮舉 0–3,000 元合法參考價，以整數最小單位精確算法對照 calculatePriceLimits（目前 21 mismatch）
# 2. 價格換成整數最小單位後再 floor／ceil
# 3. 查證 ETF／受益憑證升降單位後，tick 表依商品別分開；未查證的商品別明寫缺口，不編數字
# 4. validateOrderTypeInSession 帶 lot：零股只收限價
npm test && git diff --check
```

驗收：窮舉 0 mismatch；ETF 規則在 RESEARCH_LEDGER 有來源與查驗日期。

#### B3 狀態與引擎（S）

- 斷路器 tripped／reason 寫入 versioned localStorage，加 reload 測試（R-027；決策 D2）
- `server/start-market-proxy.js` 以 unref interval 排程 `probeStale()`，shutdown 時清除（R-030）
- `js/research.js` 依實際成交更新 target，加「配置回 0」回歸測試（R-031）
- 順手修：`riskFreeRate` 單位與 UI 標示一致；日損分母統一為 session 開盤 equity；proxy 第二個逾時計時器清除、latency 用注入 clock

驗收：reload 後斷路器維持凍結；stream 測試涵蓋 LIVE→STALE→LIVE 由排程觸發。

#### B4 跨平台（S）

- `tests/proxy-runtime.test.js`：win32 以 `exit`／`signal` 事件判定程序結束（不 skip）
- `check:syntax` 改為 Node 腳本，不依賴 find／xargs
- 或在 `CONTRIBUTING.md` 明訂只支援 POSIX 環境（二選一，於 PR 記錄）

驗收：Windows 與 ubuntu 的 `npm test` 皆全綠，或文件明訂不支援 Windows。

---

### Track C — 驗證體系（第 3–4 週）

目標：讓「全綠」代表使用者流程可用，並讓現況文件不再靠人工追數字。

對應風險：R-032；治理項需明確批准（見 Phase 7 B 與決策 D4、D6）。

#### C1 Browser E2E 進 CI（M，依賴與 CI 門檻變更需批准）

```bash
git checkout -b ci/browser-e2e origin/main
# 1. 工具：Playwright 只在 CI 安裝，不進 runtime（決策 D6）
# 2. 情境：
#    - 角色切換 → TW／US 預覽＋確認（以固定 clock 落在台北交易時段）
#    - 斷路器手動觸發 → reload → 仍凍結
#    - Fugle 模式：本機起 server/market-proxy.js＋fixture fetchImpl，驗證 quote／研究／錯誤狀態
#    - SSE：fake stream provider 斷線 → 重連 → 狀態回 LIVE
# 3. 突變驗證：暫時移除 referencePrice（回放 R-023），確認 E2E 紅燈後還原
```

驗收：E2E 在 ubuntu runner 穩定通過；回放 R-023 時確實紅燈。

#### C2 治理加固（S，逐項批准）

- main branch protection＋required `Quality`（與 C1 的 E2E）
- CodeQL＋secret scanning
- commit 身份一致（不再出現 `root@localhost.localdomain`）；刪除已合併分支

驗收：每項有「批准人／日期／理由」；未批准的不做。

#### C3 狀態自動化＋文件收斂（M）

- CI 在 job summary 輸出 HEAD、tests、gates；`docs/PROJECT_STATUS.md` 只保留 scope、known gaps、enforcement，不再手寫會過期的數字
- `scripts/check-status.js` 隨之調整：檢查「變更是否需要更新 gaps／scope」，不再要求手寫 HEAD
- `PROJECT_AUDIT`、`DELIVERY_REPORT` 標為歷史；評估 `FUTURE_PLAN` 與 `PROJECT_ROADMAP` 合併

驗收：合併任一 PR 後，STATUS 不需人工補 HEAD 也不會與 main 矛盾。

---

### Track D — 產品與架構（第 2 個月起，逐項決策）

1. 依頁籤拆分 `js/app.js`（931 行），每拆一頁 E2E 維持綠燈（M）
2. TWSE 休市日曆與除權息調整資料（R-013）（M）
3. 以真實串流驅動紙上限價撮合＋reconciliation（R-003）（L）
4. server-side 帳本與登入：只在多人使用需求確立後啟動（ADR-005 方案 D）（L）

---

### 稽核後決策點

| ID | 決策 | 建議 | 批准人／日期／理由 |
|---|---|---|---|
| D1 | 公開 proxy 維持完全公開，或加前門（短效 token／僅限自用） | 先完成 A2；Fugle 條款書面確認前改為僅限自用 | 待定 |
| D2 | 斷路器觸發後是否允許減碼／平倉單 | 允許降低曝險、禁止新增曝險 | 待定 |
| D3 | 台股紙上單是否強制真實交易時段 | 模擬資料加「模擬時鐘」模式；Fugle 模式維持真實時段 | 待定 |
| D4 | 啟用 main branch protection＋required checks | 啟用（Track C2） | 待定 |
| D5 | PR#28 是否在 A2 合併後才合併 | 原建議「是」 | **已過期**：#28 於 2026-09-22 合併；改走 A4 錯誤態補齊 |
| D6 | Browser E2E 工具引入方式 | Playwright 只在 CI 安裝，不進 runtime | 待定 |

---

## 附錄 A — 完工定義（DoD，每 PR 對照）

- [ ] 驗收標準全過；根因解掉非繞過；回歸測試先紅後綠
- [ ] `check:syntax`／`npm test`／`check:static`／`check:ui`／`git diff --check` 全過
- [ ] PR 對應 Quality 綠燈且 annotations 為 0（或逐條解釋）
- [ ] final diff 已審；文件同步（或 N／A＋原因）；無秘密／暫存檔／除錯垃圾
- [ ] 風險與後續已記入 RISK_REGISTER；未解阻擋列出不隱藏

## 附錄 B — 禁止事項（看到就停）

真實下單路徑、券商 secret 進 repo、paper 冒充 live、零成本回測、未來函數、localStorage 當授權、
靜默縮單／改價、skip CI、force push 共享歷史、未批准的 CI 門檻／依賴／治理變更。
