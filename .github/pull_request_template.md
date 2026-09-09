# Pull Request

## Summary
<!-- 用 1–3 點說明這個 PR 解決什麼。 -->

## Root cause
<!-- 若是修 bug，說明根本原因；新功能填 N/A。 -->

## Changes
<!-- 列出實際變更，避免只寫「更新 UI」。 -->

## Acceptance criteria
- [ ] 紙上交易與模擬資料邊界沒有被繞過
- [ ] 無未授權的真實下單、秘密或憑證進入 repo
- [ ] 相關 UI／鍵盤操作／錯誤狀態已驗證
- [ ] 文件與程式行為同步

## Verification
<!-- 必須寫命令、結果與 exit code，不只寫 tests passed。 -->
```text
npm run check:syntax    # exit code:
npm test                # exit code:
npm run check:static    # exit code:
git diff --check        # exit code:
```

## Required CI
- [ ] GitHub Actions `Quality` 通過
- [ ] CI run 對應本 PR 最新 commit（不是舊 artifact）

## Documentation impact
- Updated: <!-- 填檔案，或寫 N/A + 原因 -->

## Risks
<!-- 資料、回測假設、瀏覽器相容性、交易風險。 -->

## Decision required
<!-- 需要 reviewer 決定的事項；沒有就寫 None。 -->

## Follow-up
<!-- 不阻擋本 PR 的後續工作；沒有就寫 None。 -->
