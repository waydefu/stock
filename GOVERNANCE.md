# Repository Governance

## 目前治理狀態

- `main` 是整合分支。
- 所有程式修改走 Pull Request；PR 必須通過 `.github/workflows/quality.yml`。
- Merge 是人工決策，不由 agent 自動執行。
- 本 repo 的 CI 只做可重現的靜態檢查與單元測試，不連接真實券商。

## 角色（RBAC）

| 角色 | 可做 | 不可做 |
|---|---|---|
| Observer（觀察者） | 看行情、策略報告、稽核日誌 | 建立或啟動交易策略 |
| Trader（交易員） | 建立紙上訂單、啟停紙上策略 | 繞過風控或直接改稽核紀錄 |
| Risk officer（風控官） | 設定風險門檻、啟動斷路器、凍結策略 | 直接修改歷史成交紀錄 |
| Maintainer（維護者） | 審查程式、維護 CI、合併 PR | 未經決策把 paper adapter 改成 live adapter |

UI 的角色切換只代表原型狀態，不能取代後端授權（authorization）。未來接服務端時必須在服務端重新驗證。

## 不可繞過的安全門檻

1. 紙上交易（paper trading）是預設與唯一內建執行模式。
2. 單筆金額上限、日損斷路器、下單二次確認、稽核日誌不可由一般交易操作靜默關閉。
3. 回測必明列手續費、滑價、樣本數與資料時間範圍；不可把回測數字當成實盤保證。
4. 任何外部 API key、secret、CA 憑證、`.env` 或真實客戶資料不得進 repo、PR、CI log。
5. 讀不到行情、資料過期或訂單狀態不確定時，系統要停單並顯示可採取的處理方式，不得猜測成交。

## 變更治理

- live trading、IAM／權限、資料庫遷移、分支保護、required CI、測試門檻、主要依賴升級與破壞性變更，需明確決策後才做。
- Merge、正式部署與公開發布由 repo 維護者決定；agent 可準備 PR 與驗證，但不代替合併決策。
- CI 失敗要修根因，不得 skip、disable、rerun 到綠或降低門檻。

## 報告與稽核

PR 必須留下驗證命令與 exit code；涉及 UI、資料流、風控、免責或外部接線時，必填 Documentation impact、Risks、Follow-up。稽核紀錄只增不改；展示資料要標示為模擬。
