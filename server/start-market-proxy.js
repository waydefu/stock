/* Production entrypoint: read env → validate → listen → graceful shutdown.
   Domain logic lives in server/market-proxy.js; this file only wires runtime.
   Missing FUGLE_API_KEY fails startup (fail-fast); per-request AUTH_REQUIRED
   semantics in createProxy() remain for tests. Startup logs never echo secrets. */
import { createProxy } from "./market-proxy.js";
import { createStreamManager } from "./fugle-stream-manager.js";

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";
/* STALE 探測間隔：官方 heartbeat 30s，stale 門檻 60s，因此每 15s 探一次。 */
const STALE_PROBE_INTERVAL_MS = 15_000;

export function resolveRuntimeConfig(env = process.env) {
  const port = Number(env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT 必須是 1-65535：${env.PORT}`);
  }
  const host = env.HOST ?? DEFAULT_HOST;
  if (typeof host !== "string" || !host) throw new Error("HOST 必須是非空字串");
  if (!env.FUGLE_API_KEY) {
    throw new Error("FUGLE_API_KEY 未設定：拒絕啟動公開 proxy（請在 runtime secret store 設定）");
  }
  return { port, host };
}

/* R-030：正式流程排程 probeStale()，個別代碼沉默時要廣播 STALE。
   unref：不因為排程而讓 process 活著；stop() 時清除。抽成可測試的純接線。 */
export function startStaleProbe(streamManager, { intervalMs = STALE_PROBE_INTERVAL_MS, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval } = {}) {
  const handle = setIntervalImpl(() => {
    try {
      streamManager?.probeStale?.();
    } catch {
      /* probe 失敗不影響 proxy 主流程 */
    }
  }, intervalMs);
  handle?.unref?.();
  return {
    stop() {
      try { clearIntervalImpl(handle); } catch { /* already cleared */ }
    },
  };
}

async function main() {
  let config;
  try {
    config = resolveRuntimeConfig();
  } catch (error) {
    console.error(`market-proxy refusing to start: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const streams = createStreamManager({
    apiKey: process.env.FUGLE_API_KEY ?? "",
    webSocketFactory: (url) => new WebSocket(url),
    logger: (entry) => {
      console.log(JSON.stringify({ ...entry, at: new Date().toISOString() }));
    },
  });
  const { start } = createProxy({
    streamManager: streams,
    logger: (entry) => {
      console.log(JSON.stringify({ ...entry, at: new Date().toISOString() }));
    },
  });
  const running = await start(config.port, config.host);
  console.log(`market-proxy listening on ${running.url}`);
  /* R-030：正式流程排程 probeStale()，個別代碼沉默時要廣播 STALE。
     unref：不因為排程而讓 process 活著；shutdown 時清除。 */
  const staleProbe = startStaleProbe(streams);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    staleProbe.stop();
    streams.shutdown();
    await running.close();
    process.exitCode = 0;
    /* 開啟的 IPC channel 會讓 event loop 保持存活；斷線後讓 process 自然結束（exit code 0）。 */
    try {
      if (typeof process.disconnect === "function" && process.connected) process.disconnect();
    } catch {
      /* channel 已關閉 */
    }
  };
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
  /* 跨平台優雅關閉：Windows 沒有真正的 SIGTERM 語意，測試（與人類）可改送
     IPC 訊息觸發同一條 shutdown() 路徑，驗證的是同一段 graceful shutdown 程式碼。 */
  if (typeof process.send === "function") {
    process.on("message", (message) => {
      if (message === "shutdown") void shutdown();
    });
  }
}

const invokedDirectly = typeof process.argv[1] === "string" && process.argv[1].endsWith("start-market-proxy.js");
if (invokedDirectly) {
  void main();
}
