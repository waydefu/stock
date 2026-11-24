# Web / Windows / Android 交付契約

Web（Pages）、Windows x64（portable EXE、NSIS setup EXE）、Android ARM64（debug APK）使用同一份 stage:web 白名單輸出 dist/，不打包 archive、tests、docs、配置秘密或交易權限。Tauri 2 容器無 plugin、invoke handler、外部頁面、網路連線能力配置；本版只展示離線 PAPER/OFF。

## Actions
- PR 與 main push 執行 Native packages；兩平台獨立 runner，失敗不吞掉。Actions artifacts 保留 14 日，含原始建置解析的 npm/Cargo lock 與 SHA256SUMS。
- Windows x64 目標 MSVC，EXE 未做 Authenticode 簽章；安裝器需 WebView2。Android aarch64-linux-android 目標，APK debug key 由建置環境產生，apksigner 及 ELF ABI 路徑檢查，不代表實機啟動。不同 debug key 可能無法覆蓋安裝。
- 自動 tag 發布暫停：Native workflow 僅唯讀建置及上傳 preview artifacts，無 contents:write。待可信發布工作、tag 保護、完整鎖定、簽章與真機證據後另案恢復；Web 仍由 Pages workflow 自動部署。
- npm lock 已從兩平台相同解析結果固定，native CI 使用 npm ci。Cargo 暫以同一已驗證 lockfile 的 SHA-256 前後檢查，若上游解析漂移即失敗；尚未把完整 Cargo.lock 提交，不等於可重現。正式發布前須匯入完整 Cargo.lock、cargo --locked、Gradle 依賴鎖與驗證、固定工具鏈、SBOM、簽章及真機測試。
- Windows 正式簽章與 Android release keystore、簽章輪替/升級驗收另案；禁止提交 keystore、password、金鑰或交易秘密。更新服務未實作。

## 本機
安裝官方前置環境 Node 24、Rust/MSVC+WebView2（Windows），或 JDK/Android SDK/NDK（Android）。在 repo 根目錄：
```sh
npm ci --ignore-scripts
npm run check:packaging
npm run native:icons
npm run native:windows -- --target x86_64-pc-windows-msvc
# Android：設定 JAVA_HOME/ANDROID_HOME/NDK_HOME
rustup target add aarch64-linux-android
npm run native:android:init
npm run native:icons
npm run native:android
```
首次 Android Gradle 專案由固定 CLI 生成，不納入目前 repo；正式版本需固定生成成果或驗證等價。不得把手機當可靠 24/7 交易服務。

## 驗收
1. 相同 commit 的 Quality、Browser E2E、CodeQL、Native packages 均有證據。
2. 下載 EXE、setup EXE、APK，驗證 SHA-256；Windows 檢查 PE 與安裝/啟動、Android 檢查 package id、arm64-v8a、簽章、安裝/啟動；操作 fixture 通過與拒絕。
3. 真機離線啟動、PAPER/OFF、資料缺失、重啟、安全界面與原封存隔離。若未完成，不宣稱可安裝或已測。
4. 交易/AI/常駐服務仍是獨立後續開發，不能因 native bundle 通過視為交易服務可用。

官方資料： https://v2.tauri.app/start/prerequisites/ ; https://v2.tauri.app/reference/cli/ ; https://v2.tauri.app/develop/icons/ ; https://v2.tauri.app/distribute/sign/android/ ; https://v2.tauri.app/release/

## Native 版本相容性
Tauri Core 2.12.7、CLI 2.12.6、Build 2.7.6 依上游同一版本樹對齊（https://github.com/tauri-apps/tauri/tree/tauri-v2.12.7）；原 Core 2.11.5 與解析出的 Runtime 2.12.4 / Wry 2.12.5 型別不相容，兩平台 CI 已證實。新版需重新建置驗證，仍未提交完整傳遞依賴鎖。

## Android 專屬 Activity
生成 Gradle 專案後，由 scripts/apply-android-overlay.js 將受版本管理的 src-tauri/android-overlay/MainActivity.kt 覆寫到固定 package 下的 MainActivity。native:android:init 與 native:android 都必須執行 overlay，缺少生成專案或 package 不符直接失敗。原生沉浸式顯示與 WindowInsets 安全區僅影響 Android；不更動 Web/Windows，不新增 JS bridge 或權限。實際遮擋及滑動系統列需真機驗收，見 UI_UX.md。
