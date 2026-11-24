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

## 模組化與關注點分離（SoC）
採 modular monolith + ports/adapters 思路，先保持單一部署、低依賴與單一交易權威，不為拆分而引入微服務。依賴單向，composition root 負責組裝，UI 不直接依賴 domain 或執行端。
| 現行模組 | 職責 | 依賴 |
|---|---|---|
| js/domain/risk.js | 純風控與金額政策 | 無 |
| js/application/fixture.js | 離線情境與調用 | domain |
| js/application/flow.js | 純流程狀態投影 | 無 |
| js/ui/ | DOM、路由、設定、流程呈現 | 同層；以注入函式調用 application |
| js/app.js | composition root | application、ui |
| src-tauri/ | 平台生命週期與顯示 | 僅交付 dist，無交易權限 |
後續按業務能力新增 market、intelligence、events、decision、quant、risk、paper-execution、ledger/reconciliation、observability 模組；外部 REST/WS、LLM、SQLite、通知為 adapters，domain 不讀 DOM、HTTP、DB、環境變數或系統時鐘；時間、資料及政策以明確輸入傳入。應用層協調用例；持久化與交易執行有單一權威。事件稽核獨立於成交，HOLD、拒絕、錯誤均須留存。所有跨模組契約版本化，禁止循環、隱含全域狀態及跨層直接寫入；未實作模組只列規劃，不建立假 adapter。
Module contract 以顯式 inventory/allowed import graph + CI 驗證；現行檢查是受限 ESM 形式的架構回歸閘門，非 JS sandbox 或完整安全分析。新增模組需同步白名單、測試、架構文件及 ADR。

獨立層級方向矩陣（root → application/ui；application → domain/application；domain → domain；ui → ui），即使修改 import inventory 也不能繞過方向規則；新增禁止依賴、循環、未登記模組和 host API 的反例測試。未來 adapters 需 ADR 擴充矩陣。

M1 首批 server/market/ 採獨立 backend boundary，contract 純規則；application 注入 market/clock port；binance-rest 外部 adapter；scripts/market-smoke.js 組裝。僅手動唯讀，不進 dist，不與 UI fixture 或風控執行接線。詳見 MARKET_DATA.md。

M1 backend 暫以 tests/market-architecture.test.js 檢查明確模組 inventory、純契約與 adapter 依賴、UI 打包隔離；CodeQL server/ 納入掃描。後續新業務模組以 ADR 擴充統一架構矩陣。
