---
name: release-review
description: 變更審查；適用於 Crypto Lab 的對應任務。
---
# 變更審查

先讀治理與狀態，檢查 scope、archive tree、秘密、CI 與測試；跑指定命令，報 exit code、尚未驗證項；不得自動合併、部署或降門檻。

輸出：證據、實際執行項目、失敗與限制、下一步；必要時更新 PROJECT_STATUS 和 RISK_REGISTER。

依賴升級（Dependabot）：依 ADR 0004，不豁免狀態閘門；補文件 commit，逐一對照釘選 SHA 與官方 tag、讀大版本 release notes，同提交 CI（含 Native）全綠後交維護者合併，被取代的 PR 註明後關閉。
