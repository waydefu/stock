# Crypto Lab v2｜架構與里程碑

目標：事件驅動、AI 主導研究、確定性風控與自動執行的交易研究系統。長期淨收益是研究目標，不是承諾。初始虛擬本金 30 USDT，優先低營運成本。

```text
public market feeds + news + macro → immutable evidence/event store
→ trigger scheduler → AI research/decision (structured intent or HOLD)
→ quant verification → independent risk policy → paper execution authority
→ reconciliation + durable ledger + observability → dashboard / research replay
```

資料模型：source, observedAt, eventAt, fetchedAt, sequence, quality, expiresAt；symbol/venue/market_type 分離，spot 不套 futures；金額以 decimal/fixed point，規則版本化。AI 只能接公開唯讀資料及隔離研究工具，輸出有證據 ID、版本、期限的意圖，不能執行任意程式或指令。風控拒絕由程式決定。交易權限預設 OFF；現有 fixture 模擬無 network。

| 階段 | 交付 | 驗收 |
|---|---|---|
| M0 | 新 UI、治理、離線 fixture | 來源/模式清楚，拒絕測試、archive 隔離 |
| M1 | Binance 公開 REST/WS、公告與事件 | 時序、重連、過期、限流、缺口、來源驗證 |
| M2 | AI 事件推理與量化佐證 | 結構化 schema、反證、模型成本、prompt injection 測試、HOLD |
| M3 | 自動紙上交易 | 冪等、partial fill、拒單、數量/費率、SQLite transaction、對帳、重啟 |
| M4 | 故障與安全驗收 | 停機、未知訂單、斷線、資金/曝險、逐筆回放、盲樣本與前向驗證 |
| M5 | 實盤可行性評估 | 另案使用者授權、完整法遵與安全審查；未過不得實盤 |
| M6 | 多策略與改進 | 獨立研究、固定版本、成本與樣本外、重新晉升 |

排程方向：行情以事件串流，1/5 分鐘品質與異動，新聞按來源可用性與限流，AI 僅重大事件喚醒，全天服務需持久主機與監控；以上尚未實作。優先沿用 Node.js 24 零依賴基礎；Rust/Python/資料庫等依需求與 ADR 另評，不一次大改。
