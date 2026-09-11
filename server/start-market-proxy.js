/* Production entrypoint: read env → validate → listen → graceful shutdown.
   Domain logic lives in server/market-proxy.js; this file only wires runtime.
   Missing FUGLE_API_KEY fails startup (fail-fast); per-request AUTH_REQUIRED
   semantics in createProxy() remain for tests. Startup logs never echo secrets. */
import { createProxy } from "./market-proxy.js";

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";

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

async function main() {
  let config;
  try {
    config = resolveRuntimeConfig();
  } catch (error) {
    console.error(`market-proxy refusing to start: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const { start } = createProxy({
    logger: (entry) => {
      console.log(JSON.stringify({ ...entry, at: new Date().toISOString() }));
    },
  });
  const running = await start(config.port, config.host);
  console.log(`market-proxy listening on ${running.url}`);
  const shutdown = async () => {
    await running.close();
    process.exitCode = 0;
  };
  process.once("SIGTERM", () => { void shutdown(); });
  process.once("SIGINT", () => { void shutdown(); });
}

const invokedDirectly = typeof process.argv[1] === "string" && process.argv[1].endsWith("start-market-proxy.js");
if (invokedDirectly) {
  void main();
}
