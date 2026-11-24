# ADR-006: Trusted Market Data Proxy Runtime

## Status

Accepted（2026-09-11；維護者已部署並以真 smoke 驗證，見 Decision。）

## Decision（實際採用）

- **Chosen runtime：Render HTTPS Web Service**（`https://stock-fugle-proxy.onrender.com`），
  跑 `server/Dockerfile`（Node 24-bookworm-slim、非 root `node` 使用者、`HEALTHCHECK /healthz`）。
  原 Options A／B／C 評估保留作歷史；Render 即「受管 Node hosting」一類，
  程式仍 deploy-neutral（標準 `node:http` 語義，搬家成本低）。
- **Secret custody：`FUGLE_API_KEY` 只存在 Render runtime secret／env**，
  永不進 repo／Pages artifact／browser bundle／CI log／chat。
- **Anti-abuse（prototype 級，誠實範圍）：**
  per-process sliding-window rate limiter（120 req／60s，超限回 `RATE_LIMITED`＋`Retry-After`）。
  **非分散式、非 production-grade**；
  CORS allowlist 只是瀏覽器 sharing 政策，**不是存取控制**（curl 仍可直呼公開 proxy），
  不得把 CORS 說成 auth。若需對外限縮，後續加前門 key／quota（另案）。
- **Verification（已實際執行，非 fixture）：**
  `REMOTE_QUOTE_SMOKE=PASS`（2330、provider=FUGLE）、
  `REAL_HISTORY=PASS`（historical bars、provider=FUGLE）、
  `REAL_RESEARCH_SMOKE=PASS`（bars=232、OOS 已跑）。
  `promotion=FAIL` 是研究 gate 結果（策略 OOS 落後 benchmark），不是 smoke failure，
  不得宣稱為策略獲利或可 promotion。
- **殘留限制：** 免費／共享 runtime 可能冷啟動與休眠；Pages 端 browser acceptance
  已於 2026-09-11 PASS（真瀏覽器：Fugle quote＋232 bars 研究＋GATE FAIL＋provenance FUGLE＋無秘密外洩）。

## Context

7B1 建成 `server/market-proxy.js`（plain Node 24 `node:http`，零新增依賴）：
固定上游 `https://api.fugle.tw`、固定兩路由、GET-only、CORS allowlist、
`FUGLE_API_KEY` 只讀 process env。部署到哪裡由本 ADR 決定。

## Options

| 方案 | Key custody | 維運負擔 | 冷啟動 | 供應商鎖定 | 備註 |
|---|---|---|---|---|---|
| A：自管 Node（現有主機／VPS） | 營運者 env，完全自主 | 中（行程＋TLS＋重啟） | 無 | 無 | 與本 repo 零依賴哲學一致 |
| B：Cloudflare Workers | Workers secrets | 低 | 極低 | 中（Workers runtime；`node:http` 需改寫 fetch-handler） | 注意：本 proxy 用 `node:http`，上 Workers 要小幅改寫 |
| C：Vercel／Node serverless | env vars | 低 | 有（idle 後） | 中 | Node runtime 可近乎原樣跑 |

## Recommendation

**先 A（自管 Node），B／C 為備選。**理由：key 不出營運者手、無新供應商、
程式碼 deploy-neutral（標準 Request／Response 語義，搬家成本低）。
本輪不部署任何 cloud service；決定權在維護者。

## Consequences

- 決定前：proxy 只能跑在本機／可信內網；Pages 的 Fugle 模式顯示不可用（誠實狀態）。
- （歷史，7B2 當時）7B2 構建環境驗證：無公開 HTTPS 主機、無部署憑證可用 → 本 ADR 維持 Proposed；
  接受條件＝已備妥主機＋key custody＋anti-abuse 後由維護者改 Accepted 並部署。
  （已發生：2026-09-11 維護者部署 Render 並以真 smoke 驗證，狀態見上 Decision。）
- CORS allowlist 不是存取控制：evil origin 拿不到 ACAO header，但 request 仍會打到
 proxy，curl 也能直呼。正式公開部署前必須加 anti-abuse／quota protection
 （速率配額、來源審計、必要時 API key 前門），不能把 CORS 當 API key 的替代品。
- 若選 B：需把 `server/market-proxy.js` 的 `node:http` 層換成 fetch-handler
 （路由／映射／契約測試不動，只換 transport 外殼）。
