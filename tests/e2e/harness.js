/* Browser E2E harness（Track C1）：本機起「靜態站 + 真實 proxy（fixture 上游）」，
   讓瀏覽器跑真實使用者流程。所有上游資料都來自 tests/fixtures/fugle/，
   不連外網、不用任何付費服務。 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProxy } from "../../server/market-proxy.js";
import { createStreamManager } from "../../server/fugle-stream-manager.js";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const QUOTE_FIXTURE = JSON.parse(await readFile(join(ROOT, "tests/fixtures/fugle/quote-success.json"), "utf8"));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/* 靜態站：只服務 repo 內的檔案；runtime-config.js 由測試注入 proxy URL。 */
export async function startStaticServer({ proxyUrl }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    if (pathname === "/runtime-config.js") {
      res.writeHead(200, { "content-type": MIME[".js"], "cache-control": "no-store" });
      res.end(`globalThis.__MARKET_DATA_PROXY_URL__ = ${JSON.stringify(proxyUrl)};\n`);
      return;
    }
    const target = join(ROOT, normalize(pathname).replace(/^[/\\]+/, ""));
    if (!target.startsWith(ROOT)) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end("forbidden");
      return;
    }
    try {
      const body = await readFile(target);
      res.writeHead(200, { "content-type": MIME[extname(target)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(done)),
  };
}

/* 上游 stub：只回 fixture，不連外網。 */
export function createFixtureFetch() {
  return async (url) => {
    const text = String(url);
    if (text.includes("/intraday/quote/")) {
      const symbol = text.split("/intraday/quote/")[1].split("?")[0];
      return jsonResponse({ ...QUOTE_FIXTURE, symbol });
    }
    if (text.includes("/historical/candles/")) {
      return jsonResponse({
        symbol: "2330", type: "EQUITY", exchange: "TWSE", market: "TSE", timeframe: "D",
        data: [
          { date: "2026-09-10", open: 560, high: 570, low: 558, close: 566, volume: 1000, change: 1 },
          { date: "2026-09-11", open: 566, high: 572, low: 564, close: 568, volume: 1200, change: 2 },
        ],
        sort: "asc",
      });
    }
    return jsonResponse({ message: "fixture 不支援此路徑" }, 404);
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() { return payload; },
  };
}

/* 假的 Fugle WebSocket：自動完成 auth → subscribe → 逐筆，讓瀏覽器端
   真的走過 CONNECTING → LIVE；測試可主動 close() 模擬上游斷線。 */
export function createFakeUpstream() {
  const sockets = [];
  let serial = 0;
  const factory = () => {
    const socket = {
      readyState: 1,
      sent: [],
      closed: false,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send(raw) {
        const message = JSON.parse(raw);
        socket.sent.push(message);
        if (message.event === "auth") {
          queueMicrotask(() => socket.receive({ event: "authenticated", data: { message: "Authenticated successfully" } }));
        }
        if (message.event === "subscribe") {
          serial += 1;
          const id = `cid-${serial}`;
          queueMicrotask(() => {
            socket.receive({ event: "subscribed", data: { id, channel: message.data.channel, symbol: message.data.symbol } });
            socket.receive({
              event: "data",
              data: { symbol: message.data.symbol, price: 568, size: 10, volume: 100, time: 1685338200000000, serial },
              id,
              channel: message.data.channel,
            });
          });
        }
      },
      close() {
        if (socket.closed) return;
        socket.closed = true;
        socket.readyState = 3;
        socket.onclose?.();
      },
      open() { socket.onopen?.(); },
      receive(payload) { socket.onmessage?.(typeof payload === "string" ? payload : JSON.stringify(payload)); },
    };
    sockets.push(socket);
    setTimeout(() => socket.open(), 0);
    return socket;
  };
  return {
    factory,
    sockets,
    last() { return sockets.at(-1); },
    dropAll() { for (const socket of sockets) socket.close(); },
  };
}

/* 一次開好：靜態站 + 真實 proxy（fixture 上游）+ 假串流上游。 */
export async function startEnvironment() {
  const upstream = createFakeUpstream();
  const streams = createStreamManager({
    apiKey: "e2e-fixture-key-not-a-secret",
    webSocketFactory: upstream.factory,
    logger: () => {},
  });
  const proxy = createProxy({
    apiKey: "e2e-fixture-key-not-a-secret",
    fetchImpl: createFixtureFetch(),
    streamManager: streams,
    logger: () => {},
    rateLimit: { capacity: 200, refillPerSecond: 200 },
  });
  const running = await proxy.start(0, "127.0.0.1");
  const statics = await startStaticServer({ proxyUrl: running.url });
  return {
    staticUrl: statics.url,
    proxyUrl: running.url,
    upstream,
    async close() {
      streams.shutdown();
      await running.close();
      await statics.close();
    },
  };
}
