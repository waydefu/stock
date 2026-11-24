# Risk register

| ID | 風險 | 狀態 | 晉升前必備證據 |
|---|---|---|---|
| C-01 | AI 幻覺/外部指令注入 | OPEN | schema、來源與隔離負面測試 |
| C-02 | 過期或亂序行情 | OPEN | REST freshness/clock/sequence、批次最後評估與時鐘回退；WebSocket gap/reconnect 與實際 smoke 待驗 |
| C-03 | 重複訂單/未知成交 | OPEN | durable idempotency、查詢對帳 |
| C-04 | 資金與成本/最小名義額 | OPEN | 官方版本化規則、精度、極端情境；fixture 分項向上捨入與邊界測試，不代表實際撮合 |
| C-05 | 強平/跳空/止損失敗 | OPEN | 風險引擎與實際規則、壓力測試 |
| C-06 | 回測過擬合 | OPEN | 未見資料、成本、前向、樣本數 |
| C-07 | 金鑰洩漏/越權 | OPEN | secret isolation、RBAC、無 live path |
| C-08 | 帳務遷移/部署中斷 | OPEN | 外部資料備份、舊 Render 遷移 |
| C-09 | UI 顯示假即時/假收益 | PARTIAL | mode/source、拒絕與故障區分、流程示範隔離、發布目錄瀏覽器與實機驗收 |
| C-10 | AI/主機成本高於收益 | OPEN | 全成本預算與衡量 |
| C-11 | 交易場所/USDT/法遵風險 | OPEN | 區域與帳戶資格、交易所風險 |
| C-12 | fixture 被誤認成實盤 | PARTIAL | 無網路、無交易 API、模式拒絕測試 |

| C-13 | 供應鏈／發行不可重現 | OPEN | npm lock、完整已核對 Cargo.lock、locked 及前後雜湊 gate 已提交；同提交 native CI、Gradle 驗證、SBOM、原生掃描、簽章、tag 保護、實機驗收仍待完成 |
| C-14 | 封存或交付邊界退化 | PARTIAL | Git tree SHA 閘門、dist 白名單與瀏覽器拒絕封存資源測試、封存分支技術保護 |

| C-15 | 跨層耦合／繞過獨立風控 | PARTIAL | 明確模組圖、獨立層級方向檢查、禁止循環與跨層反例測試、純函式測試；未來 adapter/權限與實際執行邊界仍需驗收 |

所有 OPEN 不得視為已解決。
