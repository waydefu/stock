# DEPLOY_FUGLE_PROXY — trusted proxy 部署與真 smoke runbook

> 前提：本文件不含任何秘密。`FUGLE_API_KEY` 只出現在 runtime secret store，
> 永不進 repo／chat／CI log。以下 `<...>` 皆為佔位符。

## 1. 準備 Node 24 runtime（任選其一，見 ADR-006）

- 自管主機：Node >= 24，常駐行程＋TLS（反向代理）＋重啟策略。
- 或 Docker：`docker build -f server/Dockerfile -t market-proxy .`（無 daemon 的環境略過 build，只做靜態審查）。

## 2. 設定秘密（runtime secret store，不是 repo）

變數名稱：`FUGLE_API_KEY`
值：Fugle 行情 API key（向 Fugle 申請；**不要貼進聊天、issue、PR、CI log**）。

## 3. 設定 PORT（可選）

`PORT`（預設 8787）、`HOST`（預設 0.0.0.0）。

## 4. 部署並確認啟動

```bash
node server/start-market-proxy.js
# 預期 stdout：market-proxy listening on http://0.0.0.0:8787
# 缺 key 時：market-proxy refusing to start（exit 1），不對外服務
```

## 5. 健康檢查

```bash
curl -s http://127.0.0.1:8787/healthz
# {"status":"ok","service":"market-proxy"}
```

## 6. 注入 Pages proxy URL

部署 `runtime-config.js` 時將賦值換成公開 proxy URL：

```js
globalThis.__MARKET_DATA_PROXY_URL__ = "https://<proxy-host>";
```

repo 預設保持 `""`（Fugle 模式明確不可用）。

## 7. 真 smoke（按順序）

```bash
MARKET_DATA_PROXY_URL=https://<proxy-host> \
npm run smoke:fugle:remote 2330
# 預期：REMOTE_QUOTE_SMOKE=PASS symbol=2330 price=... providerTs=... ...

FUGLE_API_KEY='<set in trusted local/runtime env>' \
npm run smoke:research:fugle 2330
# 預期：REAL_RESEARCH_SMOKE=PASS provider=FUGLE ... promotion=PASS|FAIL
# promotion FAIL 仍算 smoke PASS（驗的是資料＋算法鏈，不是 alpha 獲利）
```

## 8. Pages 瀏覽器驗收

開已注入 URL 的 Pages → 切 Fugle 真實行情 → 查 2330 →
看到真價格／freshness／provenance → 抓真實日 K 跑研究 →
最新 score／OOS／gate 顯示。PAPER 標示全程存在。

## 9. 收尾

- ADR-006：Proposed → Accepted（填 chosen runtime＋key custody＋anti-abuse）。
- `docs/PROJECT_STATUS.md`：real smoke PASS＋部署 URL（URL 本身非秘密）。
- REAL smokes 三項改 PASS 後，才可談 7C。
