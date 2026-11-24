/* REAL stream smoke (Phase 7C PR3): deployed HTTPS proxy SSE, read-only.
   Proxy URL is public config (not a secret) via MARKET_DATA_PROXY_URL env.
   The Fugle key stays server-held; this script never sends one and scans
   every received byte for credential shapes before reporting.
   Machine-readable verdicts:
     REAL_STREAM_TRANSPORT=PASS   (200 + event-stream + retry + state→LIVE)
     REAL_STREAM_TRANSPORT=FAILED (anything else; exit 1)
     REAL_STREAM_TRADE=PASS       (≥1 trade frame with finite price/time)
     REAL_STREAM_TRADE=BLOCKED_BY_MARKET_CLOSED (transport ok, no trade in
       window; rerun inside a TW session to promote to PASS — never fake)
   Without a proxy URL: BLOCKED_BY_PROXY (exit 2), never fake success. */
import https from "node:https";
import http from "node:http";

const baseUrl = (process.env.MARKET_DATA_PROXY_URL ?? "").replace(/\/+$/, "");
if (!baseUrl) {
  console.log("REAL_STREAM_TRANSPORT=BLOCKED_BY_PROXY (set MARKET_DATA_PROXY_URL to the deployed proxy URL)");
  console.log("REAL_STREAM_TRADE=BLOCKED_BY_PROXY");
  process.exit(2);
}

const symbol = (process.argv[2] ?? "2330").toUpperCase();
const WINDOW_MS = Number(process.env.STREAM_SMOKE_WINDOW_MS ?? 35_000);
const url = `${baseUrl}/api/market/stream?symbol=${encodeURIComponent(symbol)}`;
const transport = url.startsWith("https:") ? https : http;

const SECRET_SHAPE = /api[_-]?key\s*[:=]|secret\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----|"apikey"\s*:/i;

const seen = { status: null, contentType: "", retry: false, states: [], trades: 0, lastTrade: null, comments: 0, secretHit: false };
let buffer = "";
let pendingEvent = null;

function handleField(event, data) {
  if (event === null) return; // comment / retry handled elsewhere
  if (event === "state") {
    try {
      const body = JSON.parse(data);
      if (body && typeof body.state === "string") seen.states.push(body.state);
    } catch { /* malformed counted implicitly by missing LIVE */ }
  } else if (event === "trade") {
    try {
      const body = JSON.parse(data);
      const price = body?.trade?.price;
      if (Number.isFinite(price) && Number.isFinite(body?.providerTimestamp)) {
        seen.trades += 1;
        seen.lastTrade = body;
      }
    } catch { /* ignore */ }
  }
}

function feed(chunk) {
  const text = chunk.toString("utf8");
  if (SECRET_SHAPE.test(text)) seen.secretHit = true;
  buffer += text;
  const frames = buffer.split("\n\n");
  buffer = frames.pop();
  for (const frame of frames) {
    let event = null;
    let data = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith(":")) { seen.comments += 1; continue; }
      if (line.startsWith("retry:")) { seen.retry = true; continue; }
      if (line.startsWith("event:")) { event = line.slice(6).trim(); pendingEvent = event; continue; }
      if (line.startsWith("data:")) { data += line.slice(5).trim(); continue; }
    }
    if (pendingEvent !== null || event !== null || data) handleField(event ?? pendingEvent, data);
    pendingEvent = null;
  }
}

function taipeiWeekday() {
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", weekday: "short" }).format(new Date());
}

const started = Date.now();
const req = transport.get(url, { headers: { Accept: "text/event-stream" } }, (res) => {
  seen.status = res.statusCode;
  seen.contentType = res.headers["content-type"] ?? "";
  res.on("data", feed);
  res.on("end", finish);
  res.on("error", (error) => { console.log(`REAL_STREAM_TRANSPORT=FAILED: stream error ${String(error?.message ?? error).slice(0, 120)}`); process.exit(1); });
});
req.on("error", (error) => { console.log(`REAL_STREAM_TRANSPORT=FAILED: request ${String(error?.message ?? error).slice(0, 120)}`); process.exit(1); });
req.setTimeout(WINDOW_MS + 5000, () => { req.destroy(); finish(); });
setTimeout(() => { try { req.destroy(); } catch { /* done */ } finish(); }, WINDOW_MS).unref?.();

let finished = false;
function finish() {
  if (finished) return;
  finished = true;
  const elapsed = Date.now() - started;
  if (seen.secretHit) {
    console.log("REAL_STREAM_TRANSPORT=FAILED: credential-like shape in SSE bytes (refusing to trust stream)");
    process.exit(1);
  }
  const transportOk = seen.status === 200
    && /text\/event-stream/.test(seen.contentType)
    && seen.retry
    && seen.states.includes("LIVE");
  if (!transportOk) {
    console.log(`REAL_STREAM_TRANSPORT=FAILED: status=${seen.status} contentType=${seen.contentType} retry=${seen.retry} states=[${seen.states.join(",")}] elapsedMs=${elapsed}`);
    process.exit(1);
  }
  console.log(`REAL_STREAM_TRANSPORT=PASS symbol=${symbol} states=[${seen.states.join("→")}] keepalives=${seen.comments} elapsedMs=${elapsed}`);
  if (seen.trades > 0) {
    const t = seen.lastTrade;
    console.log(`REAL_STREAM_TRADE=PASS symbol=${t.symbol} price=${t.trade.price} providerTs=${t.providerTimestamp} freshness=${t.freshnessStatus} count=${seen.trades}`);
    process.exit(0);
  }
  console.log(`REAL_STREAM_TRADE=BLOCKED_BY_MARKET_CLOSED (no trade in ${elapsed}ms; Taipei ${taipeiWeekday()} — rerun inside a TW session; transport already PASS above)`);
  process.exit(0);
}
