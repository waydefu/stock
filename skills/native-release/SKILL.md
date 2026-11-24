---
name: native-release
description: Web、Windows EXE、Android APK 打包、隔離、簽章及發布驗收。
---
# 跨平台交付
讀 GOVERNANCE、PROJECT_STATUS、DEPLOYMENT。只從同一 stage:web 白名單產出前端；不可把 archive、秘密、交易 API 或遠端網頁裝入容器。核對 Node/Rust/Tauri/SDK 版本、package id、版本一致性、Actions 完整 SHA。先跑 check:packaging 與測試，再各平台 build，核對實際 artifact、ABI、SHA-256、簽章及安裝啟動；記錄 commit、run、限制。Preview 不能冒充正式簽章版本；禁止自動建立 tag 或繞過發布審查。未有真機證據不得說可用。
