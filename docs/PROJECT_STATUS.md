# Project Status｜唯一現況來源

## Current
- M0 重構基礎：新中文工作台、離線紙上 fixture、確定性意圖風控、代理規則、技能與工具契約；尚未連接 Binance、新聞或 AI API。
- 新增 Tauri 2 native scaffold、共用 dist 白名單、Windows x64/Android ARM64 preview CI 與 tag release 規格；實際 CI artifact、鎖定依賴與安裝啟動驗收需對應最新 commit 證據，尚未宣稱成功。
- 舊台美股完整封存，不執行其測試或 deployment。新系統測試/CI 結果以最新 PR 與 workflow 證據為準。
- 研究 R1–20 的結果為探索性，不等於交易策略已晉升；前向尚未取得未來資料。

- Native 歷史驗收：b22bfd4 的 Web CI 及 Windows/Android 建置通過，artifact run 45364864648；不代表本次 UI 修改的驗收。
- #70：M0 先落地四個極簡主頁及獨立流程頁，提供八節點架構、可點選詳情、真正執行單一風控 fixture 的故障定位示範；全鏈路運行紀錄、真實時間與後端接線尚未完成。新 CI 待驗證。

- Android APK：新增原生沉浸式全螢幕及四邊 WindowInsets 安全區 overlay；已提交程式，Kotlin 編譯、APK 產物及實機遮擋驗收待新 CI/真機證據。

- M0 稽核：8b9d93a 的 Quality、Browser E2E、CodeQL、Dependency Review 已通過；Native 檢查中。已修正原型風控資料形狀/分項向上捨入、流程拒絕語義、初始頁與重設、發布目錄 E2E、封存 hash 與狀態同步閘門、憑證忽略。新提交須重新驗證。未有 native 真機、鎖檔與舊 Render 轉移證據。

- SoC：拆分風控 domain、fixture 與流程 projection application、DOM/router/settings/flow UI、composition root；新增模組契約閘門及純流程單元測試；保持離線，不增加網路、執行、帳本或實盤權限。初次 SoC 提交 Quality 與 Dependency Review 已通過；新增獨立層級方向與反例測試，最新提交須重新驗證。

- PR #62 已合併；main c50f09a 的 Quality、Browser E2E、CodeQL、Native packages、Pages 成功。已實際下載 deb4b77 兩端 artifact，三個二進位檔 SHA-256 皆相符。M0 後續 PR 固定 npm lock、Cargo 解析雜湊前後檢查、移除未充分保護的自動 tag 發布。完整 Cargo.lock/Gradle 驗證、簽章、實機與舊 Render 處置仍待完成。

- 鎖檔：自 #77 拆出完整已核對 Cargo.lock（SHA-256 e063673d…，與 Cargo.lock.sha256 相同）、固定 LF、cargo metadata 與兩平台建置 --locked。起因是 2026-11-24 上游解析漂移使所有 PR 的 Native 失敗（PR #83 run 45424021983）。同提交原生 CI 待驗；Dependency Review 預期因 glib（#82）失敗。

## Scope
離線單次固定情境示範；僅現貨多頭意圖風控模型。無持續服務、實際撮合、持久帳本、私有交易 API、合約或槓桿、實盤。

## Known gaps
M1 公開行情與事件資料、M2 AI 決策與量化驗證、M3 durable paper ledger/撮合、M4 安全/風控/故障驗收、M5 未來全自動實盤的另案審批。未完成時不得顯示運作中或可交易。舊 Render 服務合併前需處置。Native 正式簽章、可重現依賴鎖與實機驗收未完成，見 DEPLOYMENT.md。

## Enforcement
AGENTS、GOVERNANCE、RISK_REGISTER；新 Quality、Browser E2E、CodeQL。真實交易禁止；禁止調低風控、靜默 fallback 或混用 archive。
