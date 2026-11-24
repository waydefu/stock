# Project Status｜唯一現況來源

## Current
- main 61fa345（2026-11-24）：Quality、Browser E2E、CodeQL、Native packages（Windows x64 與 Android ARM64 建置，含 Kotlin overlay 編譯及 APK artifact）、Pages 全部成功。
- M0 離線工作台：確定性意圖風控 fixture、五個頁面（含流程頁）、SoC 模組契約閘門；尚未連接 Binance、新聞或 AI API。舊台美股已封存凍結。
- 研究 R1–20 僅為探索性，不等於交易策略已晉升。
- 供應鏈：npm lock 已固定；deb4b77 artifact 已下載，三個二進位檔 SHA-256 皆相符。
- 待辦：Windows/Android 真機安裝啟動驗收（含沉浸式 overlay 遮擋）、簽章；完整 Cargo.lock 與 --locked 已由 #84 合入；glib 公告追蹤於 #82；舊 Render 服務處置；CodeQL 與 Dependency Review 尚非 GitHub 必要檢查。
- 本次變更：PR 空白檢查改為與 base 比對；Dependabot 將 codeql init/analyze 合併成一組；Web CSP 與 Tauri CSP 完全一致並由 check:packaging 檢查；移除多餘的風控條件與多餘的 Android overlay 步驟；README 的 tag 發布敘述已更正。

- 鎖檔：自 #77 拆出完整已核對 Cargo.lock（SHA-256 e063673d…，與 Cargo.lock.sha256 相同）、固定 LF、cargo metadata 與兩平台建置 --locked。起因是 2026-11-24 上游解析漂移使所有 PR 的 Native 失敗（PR #83 run 45424021983）。同提交原生 CI 待驗；glib 公告（#82）經維護者核准單項例外：cargo tree 確認只在 Linux 依賴樹，Windows/Android 無；新增 Linux 交付前須移除。

## Scope
離線單次固定情境示範；僅現貨多頭意圖風控模型。無持續服務、實際撮合、持久帳本、私有交易 API、合約或槓桿、實盤。

## Known gaps
M1 公開行情與事件資料、M2 AI 決策與量化驗證、M3 durable paper ledger/撮合、M4 安全/風控/故障驗收、M5 未來全自動實盤的另案審批。未完成時不得顯示運作中或可交易。舊 Render 服務合併前需處置。Native 正式簽章、可重現依賴鎖與實機驗收未完成，見 DEPLOYMENT.md。

## Enforcement
AGENTS、GOVERNANCE、RISK_REGISTER；新 Quality、Browser E2E、CodeQL。真實交易禁止；禁止調低風控、靜默 fallback 或混用 archive。
