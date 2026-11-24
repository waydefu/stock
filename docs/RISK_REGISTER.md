# Risk register

| ID | 風險 | 狀態 | 晉升前必備證據 |
|---|---|---|---|
| C-01 | AI 幻覺/外部指令注入 | OPEN | schema、來源與隔離負面測試 |
| C-02 | 過期或亂序行情 | OPEN | WebSocket gap/reconnect、freshness |
| C-03 | 重複訂單/未知成交 | OPEN | durable idempotency、查詢對帳 |
| C-04 | 資金與成本/最小名義額 | OPEN | 官方版本化規則、精度、極端情境 |
| C-05 | 強平/跳空/止損失敗 | OPEN | 風險引擎與實際規則、壓力測試 |
| C-06 | 回測過擬合 | OPEN | 未見資料、成本、前向、樣本數 |
| C-07 | 金鑰洩漏/越權 | OPEN | secret isolation、RBAC、無 live path |
| C-08 | 帳務遷移/部署中斷 | OPEN | 外部資料備份、舊 Render 遷移 |
| C-09 | UI 顯示假即時/假收益 | PARTIAL | mode/source、流程示範與實際狀態隔離、瀏覽器與實機驗收 |
| C-10 | AI/主機成本高於收益 | OPEN | 全成本預算與衡量 |
| C-11 | 交易場所/USDT/法遵風險 | OPEN | 區域與帳戶資格、交易所風險 |
| C-12 | fixture 被誤認成實盤 | PARTIAL | 無網路、無交易 API、模式拒絕測試 |

所有 OPEN 不得視為已解決。
