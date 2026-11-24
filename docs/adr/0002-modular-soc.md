# ADR 0002｜Modular monolith 與 Separation of Concerns
狀態：使用者核准架構方向，PR 實作待審查。
背景：app.js 同時負責路由、DOM、風控示範、流程語義；paper.js 混合 domain 與測試資料。
決策：domain 純風控；application fixture/flow projection；UI 經注入函式消費用例；app.js 是唯一組裝點；native 僅負責平台生命週期。模組清單與直接依賴圖是顯式的，CI 驗證單向、無循環、模組覆蓋與純層 host API 限制；共享 dist 使用同一清單。
取捨：先用模組化單體，不引入微服務、IPC、框架或額外依賴。規則檢查是受限靜態回歸檢查，不當作安全 sandbox。後續按業務能力增量引入版本化契約、ports/adapters、持久化與權限隔離。現有功能及 PAPER/OFF 保持；稽核不應受成交成功與否阻斷。
