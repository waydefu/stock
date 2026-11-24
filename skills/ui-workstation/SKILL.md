---
name: ui-workstation
description: 工作台設計；適用於 Crypto Lab 的對應任務。
---
# 工作台設計

先讀 UI_UX；顯示模式、來源與失敗狀態，缺值不用假數字；鍵盤/觸控/窄寬畫面/對比；執行 E2E 與真機或瀏覽器截圖，保留證據。

輸出：證據、實際執行項目、失敗與限制、下一步；必要時更新 PROJECT_STATUS 和 RISK_REGISTER。

四個日常頁＋流程頁，遵循 docs/UI_UX.md。流程以權威 run 狀態顯示根因及阻塞，不虛構完成度、耗時或成功；離線 fixture 顯示範圍，未接線保持 off。UI 不直接重試交易或修改節點拓撲。
