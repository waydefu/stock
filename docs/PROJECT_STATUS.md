# Project Status｜唯一現況來源

## Current
- M0 重構基礎：新中文工作台、離線紙上 fixture、確定性意圖風控、代理規則、技能與工具契約；尚未連接 Binance、新聞或 AI API。
- 舊台美股完整封存，不執行其測試或 deployment。新系統測試/CI 結果以最新 PR 與 workflow 證據為準。
- 研究 R1–20 的結果為探索性，不等於交易策略已晉升；前向尚未取得未來資料。

## Scope
離線單次固定情境示範；僅現貨多頭意圖風控模型。無持續服務、實際撮合、持久帳本、私有交易 API、合約或槓桿、實盤。

## Known gaps
M1 公開行情與事件資料、M2 AI 決策與量化驗證、M3 durable paper ledger/撮合、M4 安全/風控/故障驗收、M5 未來全自動實盤的另案審批。未完成時不得顯示運作中或可交易。舊 Render 服務合併前需處置。

## Enforcement
AGENTS、GOVERNANCE、RISK_REGISTER；新 Quality、Browser E2E、CodeQL。真實交易禁止；禁止調低風控、靜默 fallback 或混用 archive。
