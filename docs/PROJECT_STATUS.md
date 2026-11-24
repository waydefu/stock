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

- PR #62 已合併；main c50f09a 的 Quality、Browser E2E、CodeQL、Native packages、Pages 成功。已實際下載 deb4b77 兩端 artifact，三個二進位檔 SHA-256 皆相符。PR #76 已合併；main 61fa345 的 Quality、Browser E2E、CodeQL、Native packages、Pages 均通過。已固定 npm lock、Cargo 解析雜湊前後檢查、移除未充分保護的自動 tag 發布。完整 Cargo.lock/Gradle 驗證、簽章、實機與舊 Render 處置仍待完成。

- M1 #64 首批：新增獨立 server/market 公開 REST last aggregate trade 證據、時鐘/新鮮度/序列判斷、固定 GET、超時/限流拒絕、手動 smoke 與反例測試；UI 仍 offline，尚無實際 smoke、WS、歷史、交易規則或常駐服務證據。加入批次最終新鮮度／時鐘回退檢查、backend 架構測試及 CodeQL server 範圍；原提交 88c0c3a 五項 CI 通過；同步最新 main 後須重新驗證。

- PR #77 原生 CI run 45400689430 在兩平台 Cargo 解析雜湊閘門失敗；從 PR #76 成功 run 45376975327 的 Windows artifact 14911981758 取回原始 Cargo.lock（111058 bytes，SHA-256 與 ADR 0003 相符），提交完整 lock、固定 LF、以 cargo metadata --locked 及建置 --locked 取代動態解析，保留建置前後雜湊。新提交的兩平台 CI、Gradle、簽章及實機仍待驗證。

## Scope
前端離線單次固定情境示範；僅現貨多頭意圖風控模型；後端僅手動公開 REST CLI，未驗證實際連線。無持續服務、實際撮合、持久帳本、私有交易 API、合約或槓桿、實盤。

## Known gaps
M1 公開行情與事件資料、M2 AI 決策與量化驗證、M3 durable paper ledger/撮合、M4 安全/風控/故障驗收、M5 未來全自動實盤的另案審批。未完成時不得顯示運作中或可交易。舊 Render 服務與外部資料處置尚無完成證據，#63 保持 open。Native 正式簽章、可重現依賴鎖與實機驗收未完成，見 DEPLOYMENT.md。

## Enforcement
AGENTS、GOVERNANCE、RISK_REGISTER；新 Quality、Browser E2E、CodeQL。真實交易禁止；禁止調低風控、靜默 fallback 或混用 archive。
