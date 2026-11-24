/* Optional REAL smoke: proxy + browser adapter against live Fugle (read-only).
   Key never leaves this process env; nothing is committed or logged.
   Without FUGLE_API_KEY: prints BLOCKED_BY_CREDENTIAL and exits 2.
   With key: verifies INVARIANTS only (never snapshots live prices into asserts). */
import { createProxy } from "../server/market-proxy.js";
import { FugleProxyAdapter } from "../js/fugle-proxy-adapter.js";

const key = process.env.FUGLE_API_KEY ?? "";
if (!key) {
  console.log("REAL_SMOKE=BLOCKED_BY_CREDENTIAL (set FUGLE_API_KEY in a trusted local shell to run)");
  process.exit(2);
}

const proxy = createProxy({ apiKey: key });
const running = await proxy.start(0, "127.0.0.1");
const failures = [];
try {
  const adapter = new FugleProxyAdapter({ baseUrl: running.url, timeoutMs: 15_000, maxAttempts: 2 });
  const quote = await adapter.quoteAsync("2330");
  const q = quote.data;
  if (!(q.symbol === "2330" && Number.isFinite(q.price) && q.price > 0)) failures.push("quote invariant");
  if (quote.meta.provider !== "FUGLE") failures.push("quote provider");
  if (!(Number.isFinite(quote.meta.receivedAt) && quote.meta.receivedAt >= Date.now() - 120_000)) failures.push("quote receivedAt");
  if (!(Number.isFinite(q.timestamp) && q.timestamp > 0)) failures.push("quote providerTimestamp");
  const { envelope, issues } = await adapter.getBarsAsync("2330", { from: "2025-12-01", to: "2025-12-31" });
  if (!(Array.isArray(envelope.data) && envelope.data.length > 0)) failures.push("bars non-empty");
  for (let i = 0; i < envelope.data.length; i++) {
    const b = envelope.data[i];
    if (!(Number.isFinite(b.o) && Number.isFinite(b.h) && Number.isFinite(b.l) && Number.isFinite(b.c) && b.h >= Math.max(b.o, b.c, b.l) && b.l <= Math.min(b.o, b.c, b.h) && b.v >= 0)) {
      failures.push(`bar ohlc #${i}`);
      break;
    }
    if (i > 0 && !(b.t > envelope.data[i - 1].t)) {
      failures.push("bars ascending");
      break;
    }
  }
  if (!Array.isArray(issues)) failures.push("issues shape");
} catch (error) {
  failures.push(`thrown ${error?.code ?? "unknown"}: ${error?.message ?? "unknown"}`);
} finally {
  await running.close();
}

if (failures.length) {
  console.log(`REAL_SMOKE=FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("REAL_SMOKE=PASS (invariants only, no prices recorded)");
