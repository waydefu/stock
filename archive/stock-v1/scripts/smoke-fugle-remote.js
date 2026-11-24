/* REMOTE quote smoke: deployed HTTPS proxy, read-only quote check.
   Proxy URL is public config (not a secret) via MARKET_DATA_PROXY_URL env.
   No Fugle key needed here (key lives in the proxy runtime).
   Without a proxy URL: BLOCKED_BY_PROXY (exit 2), never fake success. */
import { FugleProxyAdapter } from "../js/fugle-proxy-adapter.js";

const baseUrl = process.env.MARKET_DATA_PROXY_URL ?? "";
if (!baseUrl) {
  console.log("REMOTE_QUOTE_SMOKE=BLOCKED_BY_PROXY (set MARKET_DATA_PROXY_URL to the deployed proxy URL)");
  process.exit(2);
}

const symbol = process.argv[2] ?? "2330";
try {
  const adapter = new FugleProxyAdapter({ baseUrl, timeoutMs: 15_000, maxAttempts: 2 });
  const envelope = await adapter.quoteAsync(symbol);
  const q = envelope.data;
  const m = envelope.meta;
  const checks = [
    ["symbol", q.symbol === symbol.toUpperCase()],
    ["provider", m.provider === "FUGLE"],
    ["price", Number.isFinite(q.price) && q.price > 0],
    ["providerTimestamp", Number.isFinite(q.timestamp) && q.timestamp > 0],
    ["receivedAt", Number.isFinite(m.receivedAt) && m.receivedAt > 0],
    ["requestId", typeof m.requestId === "string" && m.requestId.length > 0],
    ["notSimulation", m.provider !== "SIMULATED"],
  ];
  const bad = checks.filter(([, ok]) => !ok).map(([name]) => name);
  if (bad.length) {
    console.log(`REMOTE_QUOTE_SMOKE=FAILED: ${bad.join(",")}`);
    process.exit(1);
  }
  console.log(`REMOTE_QUOTE_SMOKE=PASS symbol=${q.symbol} price=${q.price} providerTs=${q.timestamp} receivedAt=${m.receivedAt} freshness=${m.freshnessStatus} requestId=${m.requestId}`);
} catch (error) {
  console.log(`REMOTE_QUOTE_SMOKE=FAILED: ${error?.code ?? "unknown"} ${(error?.message ?? "").slice(0, 120)}`);
  process.exit(1);
}
