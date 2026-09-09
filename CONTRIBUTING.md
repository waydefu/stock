# Contributing

## 變更邊界

本專案目前是純靜態研究原型（prototype）：模擬行情、回測與紙上交易。
除非另有明確審批，不得加入真實下單路徑，也不得提交券商 API key、secret、憑證或真實客戶資料。

## 分支與提交

- 分支：`feat/*`、`fix/*`、`docs/*`、`ci/*`。
- 提交採 Conventional Commits：`feat:`、`fix:`、`docs:`、`test:`、`ci:`、`chore:`。
- 一個提交只做一個可驗證的目的；不要用 force push 改寫共享歷史。

## Pull Request

PR 必須使用範本，寫出 Summary、Root cause、Changes、Acceptance criteria、Verification、Required CI、Documentation impact、Risks、Decision required、Follow-up。

合併前要求：

1. `npm run check:syntax` 通過。
2. `npm test` 通過。
3. `npm run check:static` 通過。
4. `git diff --check` 通過。
5. GitHub Actions `Quality` 對應最新 commit 且全綠。
6. 變更涉及 UI、資料流、風控或免責時，同步更新文件。

## 本機命令

```bash
python3 -m http.server 8080
npm run check:syntax
npm test
npm run check:static
git diff --check
```

## 交易安全

所有 broker adapter 預設只能接紙上交易。任何 live trading、秘密／認證／權限變更、持久資料格式變更或破壞性 API 變更，都必須先有明確決策與額外審查；CI 不讀取也不注入真實秘密。
