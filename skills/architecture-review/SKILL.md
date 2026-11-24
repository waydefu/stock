---
name: architecture-review
description: 模組化、SoC、依賴邊界與契約審查
---
讀 ARCHITECTURE、ADR 0002、AGENTS 與 GOVERNANCE。先列模組責任、公開契約、依賴方向、權威與失敗行為，再最小改動；純 domain 不接 I/O，application 不接 DOM，UI 不直接調用執行或風控 domain；composition root 注入用例。新增模組更新 module-contract.js、測試及文檔，跑 check:architecture、check:packaging、npm test 與 E2E。不得用微服務或空殼模組假裝完成，不改實盤授權。
