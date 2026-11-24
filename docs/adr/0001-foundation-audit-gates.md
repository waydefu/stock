# ADR 0001｜M0 稽核與交付驗收
狀態：提案，待維護者審查（PR #62）。既有治理不降低。
背景：8b9d93a 的 JS CI 4 項通過，Native 檢查中。既有靜態檢查只確認封存存在，E2E 測試 repo 根目錄而非交付 dist，status check 只確認標題；風控 fixture 把預期拒絕畫成系統故障，費用與止損合併取整存在微額低估。
決策：固定封存 tree、拒絕 worktree 漂移、對完整 PR diff 強制更新狀態和風險文件、E2E 服務真正 dist 並檢查 archive/config 不可存取與無外連；白名單拒絕 symlink 父路徑；風控採 data-only 自有欄位及分項向上取整；預期風控拒絕與系統故障區分。保留 offline-only。
取捨：增加 CI checkout 深度與檢查時間，強制文件同步，但提高可稽核性；無法取代依賴鎖、簽章、正式 branch/tag 保護、原生安全掃描、實機測試與舊 Render 遷移。這些仍由 #63、#70、#72 管理。
