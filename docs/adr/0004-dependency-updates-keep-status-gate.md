# ADR 0004｜依賴升級維持狀態同步閘門
狀態：維護者已決定（2026-11-25，#86）。既有治理不降低。
背景：`scripts/check-status.js` 要求任何 workflow／腳本等執行面變更同時更新 PROJECT_STATUS 與 RISK_REGISTER。Dependabot 只改 workflow，因此 #36、#78–#81 必定在必要檢查 Quality 失敗；codeql init/analyze 被拆成兩個 PR 時各自也會失敗。
決策：不豁免 Dependabot，維持閘門。GitHub Actions 升級由 Dependabot 每週合成一個群組 PR；由維護者或代理在該分支補一個文件 commit，或另開一個合併 PR（如 #88），並逐一以 GitHub API 對照釘選 SHA 與官方 tag、閱讀大版本 release notes、確認同提交 CI（含 Native）全綠後，才請維護者合併。被取代的 Dependabot PR 關閉並註明取代者。
取捨：每批升級需人工一次，但保留每次執行面變更都留下現況與風險紀錄；不以自動化放寬稽核。npm 依賴同樣適用。
