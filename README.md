# Crypto Lab｜自主交易研究工作台

本倉庫由台美股原型轉向加密貨幣事件驅動 AI 決策與全自動交易研究。現在是 **離線紙上原型**：沒有即時行情、真實交易 API、AI 模型接線或可執行實盤權限。最終方向是由 AI 提出結構化意圖、獨立程式風控及自動執行；不要求逐筆人工批准，但實盤啟用、權限及風險政策仍需所有者明確批准與驗收。

## 執行
Node.js 24、零 runtime 依賴。
- `npm test`：新系統測試。
- `npm run check:syntax && npm run check:static && npm run check:ui && npm run check:status`：新系統閘門。
- `python3 -m http.server 8080`：開啟 http://localhost:8080/。
- `npm run e2e`：需另裝 Playwright 與 Chromium，CI 安裝。

## 文件
- [專案狀態](docs/PROJECT_STATUS.md)｜唯一現況來源
- [架構與路線圖](docs/ARCHITECTURE.md)
- [治理](GOVERNANCE.md)｜[代理規則](AGENTS.md)｜[技能目錄](skills/README.md)｜[工具契約](docs/TOOLS.md)
- [風險登錄](docs/RISK_REGISTER.md)｜[UI/UX](docs/UI_UX.md)

## 舊版封存
[archive/stock-v1](archive/stock-v1/README.md) 是原 main 的完整目錄樹（含全部測試、舊 CI、server、文件），另有 `archive/stock-v1` 分支。舊版不參與新系統執行、測試或 Pages 打包；不刪除歷史。舊 Render 服務若仍自動部署 main，合併前須由維護者停用或改指向封存分支，避免錯誤部署。舊資料不得自動遷移。詳見 [封存政策](docs/ARCHIVE.md)。
