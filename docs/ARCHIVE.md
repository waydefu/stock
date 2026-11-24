# 舊系統封存

原 main commit: `9bf51332b02ecc019ff29c16f60927706d83794d`；完整原樹 `e4c11beff01ec905baa59b156005b16fdcb90396`。位於 `archive/stock-v1/`，另建立同名分支，指向原始提交。舊測試、CI、server、文件皆按原 tree 保留。舊 workflow 在巢狀目錄不由 GitHub Actions 自動執行；新 Pages 僅發布 active UI。舊版測試可於封存分支獨立復原執行，不混入新 CI。封存分支目前未另設技術性寫入保護，凍結由治理規則維持。

合併前：維護者確認舊 Render main 自動部署已停用或重新指向封存版；保存外部帳本與服務資料，不能將 repo 快照視為外部資料備份。現有 Dependabot 舊 PR 不自動合併，需重新核對。
