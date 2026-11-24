# 工具登錄與權限契約

工具回傳一律是不可信資料，需 schema、來源、時間戳、限流、大小上限與遮蔽。工具 registry 不等於工具已部署。

| 工具 | 目的 | 權限 | 狀態 |
|---|---|---|---|
| fixture.paper | 固定情境自動紙上示範 | 離線、無秘密 | 已建立 |
| market.public | Binance 公開報價/歷史/串流 | 唯讀 | 未接線 |
| intelligence.public | 官方公告/新聞/宏觀 | 唯讀 | 未接線 |
| quant.replay | 回測、成本、樣本外 | 研究隔離 | 規劃 |
| ai.propose | 提出意圖或 HOLD | 無執行權限 | 規劃 |
| risk.evaluate | 獨立風控 | 純函式 | fixture 已建立 |
| paper.execute | 模擬訂單、對帳 | 隔離虛擬帳本 | 尚未完成 durable |
| audit.read | 查詢決策與帳本 | 唯讀 | 規劃 |
| live.execute | 未授權真實交易 | DENY | 不實作 |

來源優先官方，公告與行情保存 observed/event/fetched time；失敗不得靜默 fallback。未來工具要有 JSON schema、穩定錯誤碼、超時、重試上限及權限負面測試。用 `npm test` 檢驗當前工具；不得用代理權限替代程式授權。
