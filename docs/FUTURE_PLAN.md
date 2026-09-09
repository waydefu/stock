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

- HEAD：`25dd89a5712794752c599f67dbc84a34ea34a682`
- `npm test`：54 passed／0 failed；`check:static` 20 files；`check:syntax` exit 0；`git diff --check` exit 0
- Quality CI：`34388171298` success（對應同 SHA）
- UI 閘門：`npm run check:ui` 14 項全過（含實測對比表，見 `scripts/check-ui.js`）
- 已知 open PR：#1／#2（Dependabot，Actions 大版升級）、#3（Sharpe 最小樣本＋risk-free）
- 風險登錄：`docs/RISK_REGISTER.md` R-001～R-018；路線圖：`docs/PROJECT_ROADMAP.md`

---

## Phase 1 — 合併 PR#3 並同步文件（S）

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

證據：合併 commit SHA、Quality run ID、`npm test` 55 passed 輸出。

---

## Phase 2 — 回測殘留收尾（S）

目標：關閉 R-008 與費用語義缺口，不留「以後再說」的指標。

對應風險：R-008（Sharpe）、R-018（費用／滑價語義）。

步驟：

1. `riskFreeRate` 政策文件化：在 `docs/ARCHITECTURE.md` 邊界段加一行——預設 0＝未調整名目報酬，跨週期比較必須同 `periodsPerYear`＋同 risk-free 才可比。
2. 費用可插拔證明（不改預設零費用）：加一個 `FeeModel` 注入測試，用固定比例 fee model 跑一次 buy＋full sell，斷言 `totalFees > 0` 且 accounting invariants 仍成立；預設 prototype 仍為 `zero-fee-paper`，UI／README 維持「紙上零費用模型」字樣。
3. Backtest 滑價 vs paper 費用分工寫進 `docs/ARCHITECTURE.md`：前者是歷史模擬假設，後者是執行模型，名稱相同但實作分開。

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

- [ ] R-008 可關閉（min-sample＋risk-free 皆有契約＋測試＋文件）
- [ ] 預設 paper 行為零變更（既有現金數字測試全過）
- [ ] `docs/ARCHITECTURE.md` 明確寫出 backtest-slip vs paper-fee 分工

---

## Phase 3 — MarketRules：tick／price-limit／交易時段（M）

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

## Phase 4 — 儲存遷移政策＋多 tab 範圍 ADR（S）

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

## Phase 5 — UI P1 剩餘＋benchmark 重評（M）

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

## 附錄 A — 完工定義（DoD，每 PR 對照）

- [ ] 驗收標準全過；根因解掉非繞過；回歸測試先紅後綠
- [ ] `check:syntax`／`npm test`／`check:static`／`check:ui`／`git diff --check` 全過
- [ ] PR 對應 Quality 綠燈且 annotations 為 0（或逐條解釋）
- [ ] final diff 已審；文件同步（或 N／A＋原因）；無秘密／暫存檔／除錯垃圾
- [ ] 風險與後續已記入 RISK_REGISTER；未解阻擋列出不隱藏

## 附錄 B — 禁止事項（看到就停）

真實下單路徑、券商 secret 進 repo、paper 冒充 live、零成本回測、未來函數、localStorage 當授權、
靜默縮單／改價、skip CI、force push 共享歷史、未批准的 CI 門檻／依賴／治理變更。
