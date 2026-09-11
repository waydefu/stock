# ADR-006: Trusted Market Data Proxy Runtime

## Status

Proposed（2026-09-11；待維護者 infra 決策。本輪 proxy 保持 deploy-neutral，不綁任何一家。）

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
- CORS allowlist 不是存取控制：evil origin 拿不到 ACAO header，但 request 仍會打到
 proxy，curl 也能直呼。正式公開部署前必須加 anti-abuse／quota protection
 （速率配額、來源審計、必要時 API key 前門），不能把 CORS 當 API key 的替代品。
- 若選 B：需把 `server/market-proxy.js` 的 `node:http` 層換成 fetch-handler
 （路由／映射／契約測試不動，只換 transport 外殼）。
