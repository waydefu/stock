# ADR 0003｜原生交付依賴與發布閘門
狀態：提案，待維護者審核。
證據：PR #62 commit deb4b77，run 45374086377，Windows artifact 14911595517、Android 14911450741。下載兩個 ZIP，逐一驗證三個二進位檔 SHA256SUMS 全部吻合；npm lock JSON 內容相同（Windows CRLF、Android LF），Cargo lock 111058 bytes/433 packages 逐位元相同，SHA-256 e063673d05fd1def0c654be7c273d8b5cf632371d73c8a71b549a412696aa2e9。npm Android 原始 lock SHA-256 b192faa1e94521bb3913de764b0c5428a07a3b99f473dbb76f3863164ad5c55f。
決策：提交 npm lock 並使用 npm ci；暫以同一經驗證 Cargo lock 的 hash 在 native build 前後阻擋解析漂移，不宣稱完整 Cargo 鎖定或可重現建置。下一步須匯入完整 Cargo.lock 並使用 --locked；不能為綠燈直接更新 digest。移除原 tag 自動發布及 contents:write，直到可信發布工作、tag 保護、簽章與驗收完成。保留兩平台 Actions preview artifacts。
來源：https://docs.npmjs.com/cli/commands/npm-ci/ ; https://doc.rust-lang.org/cargo/commands/cargo-build.html ; https://docs.gradle.org/current/userguide/dependency_verification.html ; https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
取捨：Cargo 上游版本更新可能阻斷 preview，這是預期 fail-closed 行為；不能以 hash gate 替代真正 lockfile。Gradle 鎖定/驗證、SBOM、簽章、真機、舊 Render 遷移仍未完成。
