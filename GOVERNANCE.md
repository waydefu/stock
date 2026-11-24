# Governance v2｜自主交易研究

- 同倉庫重建，archive/stock-v1 完整唯讀封存；禁止新系統 import、執行或部署舊程式。
- main 走 PR；不 force push、不降低檢查。Quality、Browser E2E、CodeQL 政策上須通過；實際 required context 以 GitHub 設定為準。Merge 與正式部署由維護者決定。
- 現在唯一可執行模式是離線 PAPER fixture；任何 LIVE、真錢帳戶、私有交易 API、秘密與帳戶資料都不允許。即使未來全自動，也不允許 AI 自行批准模式、資金上限、策略晉升、風控或權限。未來交易服務需另案安全、法遵、資料授權、金鑰隔離與災難演練。
- 研究／決策／風控／執行／帳務權限分離。AI 輸出意圖不是訂單；獨立 deterministic risk 具否決權；執行器只能接已核准、尚未過期的意圖，commit boundary 重新驗證。拒絕不得改單重試或猜測成交。
- 行情、事件與決策具來源、事件時間、取得時間、資料版本、有效期限、反面證據；歷史回測必須避免 lookahead 與選擇偏差，區分回測、紙上、實機、實盤。
- 任何資料失效、斷線、未知狀態、失衡、超額、持久化故障應拒絕新增曝險。未來 reduce-only 退出、停機及對帳政策須獨立驗證；不得用停機保證損失上限。
- 所有重大變更（權限、CI、資料庫、執行語義、依賴、部署）必須獨立審查並記錄 ADR；禁止以假數據通過驗收。
- 審查：單元測試＋反例測試＋UI E2E＋來源版本＋驗收證據。使用者有最終系統管理權。
- Web/EXE/APK 由相同白名單 dist 建置，archive 不進任何交付。Native packages 須驗證產物、SHA-256、簽章及真機；preview tag 由維護者建立，僅受控發布工作具 contents:write。未正式簽章與依賴鎖定不得視為正式發行，見 docs/DEPLOYMENT.md。
- 模組化與關注點分離為架構原則；domain 無 I/O，application 透過明確契約協調，ui 不直接依賴風控或執行端，平台殼不承擔交易責任。CI 檢查明確模組圖、循環及交付白名單。架構邊界變更需 ADR 與審查。
