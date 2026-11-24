# ADR 0003｜原生交付依賴與發布閘門
狀態：提案，待維護者審核。
證據：PR #62 commit deb4b77，run 45374086377，Windows artifact 14911595517、Android 14911450741。下載兩個 ZIP，逐一驗證三個二進位檔 SHA256SUMS 全部吻合；npm lock JSON 內容相同（Windows CRLF、Android LF），Cargo lock 111058 bytes/433 packages 逐位元相同，SHA-256 e063673d05fd1def0c654be7c273d8b5cf632371d73c8a71b549a412696aa2e9。npm Android 原始 lock SHA-256 b192faa1e94521bb3913de764b0c5428a07a3b99f473dbb76f3863164ad5c55f。
決策：提交 npm lock 並使用 npm ci；暫以同一經驗證 Cargo lock 的 hash 在 native build 前後阻擋解析漂移，不宣稱完整 Cargo 鎖定或可重現建置。下一步須匯入完整 Cargo.lock 並使用 --locked；不能為綠燈直接更新 digest。移除原 tag 自動發布及 contents:write，直到可信發布工作、tag 保護、簽章與驗收完成。保留兩平台 Actions preview artifacts。
來源：https://docs.npmjs.com/cli/commands/npm-ci/ ; https://doc.rust-lang.org/cargo/commands/cargo-build.html ; https://docs.gradle.org/current/userguide/dependency_verification.html ; https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
取捨：Cargo 上游版本更新可能阻斷 preview，這是預期 fail-closed 行為；不能以 hash gate 替代真正 lockfile。Gradle 鎖定/驗證、SBOM、簽章、真機、舊 Render 遷移仍未完成。

## 補充決策（PR #77，待審核）
run 45400689430 於 Windows/Android 的 Cargo resolution gate 失敗，Windows 新解析 SHA-256 0dad7c2564cbc4ba17e39e1ff5fd88662d5dbbe0fad5bda6868b930b5e0fe173 與核准值不同。從成功 run 45376975327 artifact 14911981758 恢復 111058-byte 原始 lock，ZIP SHA-256 5d954cb5945d695f33040de7d0de2717b4cab20bfbd074184e408c76963895ea 及 lock SHA-256 與既有證據匹配，Git blob e5c54719806a4e4218c8d8f3b5ae9be3b84af7e0。保留原 digest，不重新解析；固定 LF、locked metadata 與兩平台 build runner --locked，保留前後 hash，權限及發布規則不變。新同提交 CI 待驗，Gradle、簽章、實機及正式發行仍未完成。
