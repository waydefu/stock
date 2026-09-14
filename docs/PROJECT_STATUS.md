# Project Status（唯一 current truth）

> 本文件是唯一「現在狀態」來源。歷史快照見 `docs/PROJECT_AUDIT.md`
> （baseline＋歷史，不再設 Current checkpoint）。
> Authority hierarchy：Runtime＋tests ＞ main HEAD ＞ ADR ＞ RISK_REGISTER ＞
> RESEARCH_LEDGER ＞ PROJECT_ROADMAP ＞ PROJECT_AUDIT（歷史）。

## Current（分支驗證；main HEAD 以 GitHub 為準，合併後以 merge commit 更新）

- Last verified main checkpoint：`1d36fe5`（PR#27 server bridge squash-merge；2026-09-14 全案稽核基準）
- Tests：260 tests；Quality（ubuntu）全過；本機 Windows 259/260（`tests/proxy-runtime.test.js` SIGTERM，Windows 限定，Track B4）；`check:static` 27 files；`check:ui` 34/34 WARN 0 FAIL 0
- Quality：以 GitHub required check「Quality」為準（含 Check status sync gate）；禁止在 version-controlled truth 內追逐自身 run ID
- Open PR：#28 `feat/phase7c-live-ui`（建議在 Track A2 後合併，決策 D5）；稽核文件 PR `docs/audit-2026-09-14`（編號與 CI 以 GitHub 為準）
- Benchmark：UI 7.9/10（舊 2.0 保留，見 `UI_UX_BENCHMARK.md`）；`score:ui` 100/100 為靜態原始碼證據，不代表使用者流程可用（R-032）
- Phase 7B1：MERGED；Phase 7B2（#20）＋proxy deploy-ready（#21）＋Docker runtime fix（#22）＋Pages 接線（#23）＋post-23 收斂（#24）＋7C streaming contract（#25）＋全域搜尋（#26）＋server bridge（#27，realtimeStream=false 維持）：MERGED；Live UI（#28）：OPEN
- Audit：2026-09-14 snapshot 見 `docs/PROJECT_AUDIT.md`；修正計畫見 `docs/FUTURE_PLAN.md`「稽核後收斂 Track A–D」
- Real-data runtime：Render `https://stock-fugle-proxy.onrender.com`；REMOTE_QUOTE_SMOKE=PASS；REAL_HISTORY=PASS；REAL_RESEARCH_SMOKE=PASS（promotion=FAIL，僅研究 gate，不影響 smoke）；Pages deployed artifact 已驗注入 URL（2026-09-11 curl 實證）；真瀏覽器 acceptance PASS（2026-09-11：Fugle quote＋232 bars 研究＋GATE FAIL＋provenance FUGLE，見 PR#24）

## Scope

paper／research-only prototype；無 live broker path；公開 Pages 不持任何憑證。

## Known gaps

### Blockers（2026-09-14 稽核，Track A／B）

1. 台股紙上下單在 UI 全數被拒：缺 `referencePrice`＋模擬價不對齊 tick（R-023，production 實測，Track A1）
2. 公開 proxy 無存取控制、全域共用限流；資料再散布授權待確認（R-024，Track A2＋決策 D1）
3. 串流名額可被單一來源佔滿；訂閱錯誤不回傳、不釋放名額（R-025，Track A2；PR#28 排在其後）
4. 台股回測／研究缺證券交易稅與最低手續費，結論偏樂觀（R-026，Track B1）

### 其他缺口（按優先序）

1. 市場規則精度：漲跌停浮點取整、ETF 升降單位、零股委託類型（R-028、R-029）
2. 狀態：手動斷路器不持久化（R-027）；server STALE probe 未排程（R-030）；研究引擎 target 與持倉可能脫鉤（R-031）
3. browser E2E＋完整 WCAG audit＋viewport 幾何實測；閘門以靜態證據為主（R-032）
4. 真 exchange calendar／corporate-action 調整資料（simplified-weekday 現狀）
5. matching＋reconciliation（立即成交模型現狀，見 R-003）
6. server authority／durable audit／secret management（ADR-005 誠實範圍）
7. provider real-data runtime：Render HTTPS proxy 已部署並通過 Fugle remote quote／historical bars／research smoke；
   Pages deployed artifact 已注入 proxy URL（curl 實證）且真瀏覽器 acceptance PASS（2026-09-11，涵蓋報價與研究，未涵蓋下單）；
   promotion=FAIL 僅代表目前策略不具升級資格，不影響資料鏈 smoke PASS
8. legacy `runBacktest` 融合路徑只維護不擴充（R-021）

## Enforcement（server side）

- Branch protection（main）：**無**（2026-09-14 API 再查驗：404 Branch not protected；啟用建議見決策 D4）
- Rulesets：**無**
- 現狀＝policy＋CI 強、server-side enforcement 缺席；啟用為維護者決策項，
  本文件只記錄、不擅自開。
