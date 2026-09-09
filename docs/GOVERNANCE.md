# Governance implementation notes

根目錄 `GOVERNANCE.md` 是治理規則；本頁記錄它如何落在介面與程式，而不是另立一套規則。

## 角色與權限

- Observer：讀市場／研究／稽核，不能建立紙上訂單。
- Trader：可建立 paper order，但仍不能改風控門檻、清除稽核或接 live adapter。
- Risk：可啟動／重置斷路器；每次操作寫入 audit log。
- Maintainer：可維護 repo 與 CI；不能把 prototype 直接改成 live trading。

這個分層吸收 cTrader 對交易 permission 的明確確認、IBKR 的 precautionary order settings 與 paper testing 邊界。[50][41][42][39]

## 風控順序

```text
權限檢查 → 帳戶狀態 → 日損斷路器 → 單筆名目上限 → 持倉檔數 → 現金／持倉 → 二次確認 → paper broker → 回讀狀態 → audit
```

任何一關失敗都停止；不會自動縮數量、改價格、改方向或換成另一個 adapter。這比「按鈕看起來成功」重要，因為 API 文件本身也提醒訂單可能被 precautionary settings 阻擋，且 paper 結果不等於 live。[41][42][36][38]

## 稽核

每筆事件至少保留：時間、事件、標的、方向、數量、價格、模式、角色、風控代碼、結果。禁止寫入 token、secret、password、CA 憑證內容。**目前前端原型的正式 scope 是 single-user session audit：事件以 versioned localStorage 保存、可匯出 CSV，但使用者可修改，不能當成 tamper-proof 或 authorization authority。**正式服務要改成 append-only server log、request id、broker order id、fill 回讀與對帳。

## CI／PR

`.github/workflows/quality.yml` 只執行語法、單元測試、靜態檔案與本機靜態伺服器 smoke test，不使用券商秘密。PR 範本要求根本原因、驗收標準、命令與 exit code、CI、風險、文件影響與後續工作。

## 尚未宣稱完成的 production 治理

- 服務端 authentication／authorization、MFA、秘密管理、session binding。
- 多租戶隔離、資料保留政策、正式稽核不可竄改儲存。
- 真實券商 adapter、訂單／成交回讀、斷線恢復與 reconciliation。
- 法律／法遵／資料授權審查與正式環境災難演練。

這些不是把幾個 UI toggle 打開就能完成的項目，因此目前保持 paper-only。

## Sources

[36] https://docs.alpaca.markets/us/docs/paper-trading
[38] https://alpaca.markets/learn/start-paper-trading
[39] https://www.interactivebrokers.com/en/trading/tws.php
[41] https://interactivebrokers.github.io/tws-api/third_party.html
[42] https://interactivebrokers.github.io/tws-api/basic_orders.html
[50] https://help.ctrader.com/ctrader-algo/documentation/plugins
