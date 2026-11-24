# Project Status｜唯一現況來源

## Current
- main 61fa345（2026-11-24）：Quality、Browser E2E、CodeQL、Native packages（Windows x64 與 Android ARM64 建置，含 Kotlin overlay 編譯及 APK artifact）、Pages 全部成功。
- M0 離線工作台：確定性意圖風控 fixture、五個頁面（含流程頁）、SoC 模組契約閘門；尚未連接 Binance、新聞或 AI API。舊台美股已封存凍結。
- 研究 R1–20 僅為探索性，不等於交易策略已晉升。
- 供應鏈：npm lock 已固定；deb4b77 artifact 已下載，三個二進位檔 SHA-256 皆相符。
- 待辦：Windows/Android 真機安裝啟動驗收（含沉浸式 overlay 遮擋）、簽章；完整 Cargo.lock 與 --locked 已由 #84 合入；glib 公告追蹤於 #82；舊 Render 服務處置；CodeQL 與 Dependency Review 尚非 GitHub 必要檢查。
- CI 閘門（#83）：PR 空白檢查改為與 base 比對；Dependabot 將 codeql init/analyze 合併成一組；Web CSP 與 Tauri CSP 完全一致並由 check:packaging 檢查；移除多餘的風控條件與多餘的 Android overlay 步驟；README 的 tag 發布敘述已更正。
- 鎖檔：自 #77 拆出完整已核對 Cargo.lock（SHA-256 e063673d…，與 Cargo.lock.sha256 相同）、固定 LF、cargo metadata 與兩平台建置 --locked。起因是 2026-11-24 上游解析漂移使所有 PR 的 Native 失敗（PR #83 run 45424021983）。#83、#88 原生 CI 已以此 lock 通過；glib 公告（#82）經維護者核准單項例外：cargo tree 確認只在 Linux 依賴樹，Windows/Android 無；新增 Linux 交付前須移除。
- CI actions 升級：合併 Dependabot #36、#78、#79、#80、#81（setup-node 7.1.0、codeql-action init/analyze 同步 4.39.4、dependency-review-action 5.0.1、upload-artifact 7.0.2）；釘選 SHA 已逐一對照官方 tag，大版本僅改 Node 24 runtime 與新增選項，未用到被移除功能。Dependabot 與 check:status 的衝突見 #86。
- M1 #64 首批：新增獨立 server/market 公開 REST last aggregate trade 證據、時鐘/新鮮度/序列判斷、固定 GET、超時/限流拒絕、手動 smoke 與反例測試；UI 仍 offline，尚無實際 smoke、WS、歷史、交易規則或常駐服務證據。加入批次最終新鮮度／時鐘回退檢查、backend 架構測試及 CodeQL server 範圍；原提交 88c0c3a 五項 CI 通過；同步最新 main 後須重新驗證。
- PR #77 程式大掃：公開行情 watchlist、時間區間、到期與 sequence 契約、限流清理及時鐘失效補強，新增反例測試；新提交 CI 待驗，不變更交易權限或封存。
- 修正（Refs #85）：成交時間的未來判斷改用已量測的時鐘不確定度（與 checkClock 一致），避免本機時鐘略慢時全部誤判 FUTURE_TRADE；過期判斷不變。

## Scope
前端離線單次固定情境示範；僅現貨多頭意圖風控模型；後端僅手動公開 REST CLI，未驗證實際連線。無持續服務、實際撮合、持久帳本、私有交易 API、合約或槓桿、實盤。

## Known gaps
M1 公開行情與事件資料、M2 AI 決策與量化驗證、M3 durable paper ledger/撮合、M4 安全/風控/故障驗收、M5 未來全自動實盤的另案審批。未完成時不得顯示運作中或可交易。舊 Render 服務與外部資料處置尚無完成證據，#63 保持 open。Native 正式簽章、可重現依賴鎖與實機驗收未完成，見 DEPLOYMENT.md。

## Enforcement
AGENTS、GOVERNANCE、RISK_REGISTER；新 Quality、Browser E2E、CodeQL。真實交易禁止；禁止調低風控、靜默 fallback 或混用 archive。
