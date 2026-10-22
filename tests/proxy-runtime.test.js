import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { resolveRuntimeConfig } from "../server/start-market-proxy.js";

test("startup config fails closed without a key", () => {
  assert.throws(() => resolveRuntimeConfig({}), /FUGLE_API_KEY/);
  assert.throws(() => resolveRuntimeConfig({ PORT: "abc", FUGLE_API_KEY: "x" }), /PORT/);
  assert.throws(() => resolveRuntimeConfig({ PORT: "99999", FUGLE_API_KEY: "x" }), /PORT/);
});

test("startup config accepts PORT and HOST overrides", () => {
  assert.deepEqual(resolveRuntimeConfig({ FUGLE_API_KEY: "x" }), { port: 8787, host: "0.0.0.0" });
  assert.deepEqual(resolveRuntimeConfig({ FUGLE_API_KEY: "x", PORT: "9999", HOST: "127.0.0.1" }), { port: 9999, host: "127.0.0.1" });
});

test("entrypoint boots, serves health, and shuts down gracefully", async () => {
  const port = 18287;
  const child = spawn(process.execPath, ["server/start-market-proxy.js"], {
    env: { ...process.env, FUGLE_API_KEY: "lifecycle-probe-not-a-secret", PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  try {
    const started = await waitFor(`http://127.0.0.1:${port}/healthz`, 8000);
    assert.equal(started.status, "ok");
    // 跨平台：用 IPC 觸發同一條 graceful shutdown 路徑（Windows 沒有真 SIGTERM 語意）。
    child.send("shutdown");
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 0);
  } finally {
    child.kill("SIGKILL");
  }
});

test("entrypoint shuts down on SIGTERM (per-platform exit/signal semantics, no skip)", async () => {
  const port = 18288;
  const child = spawn(process.execPath, ["server/start-market-proxy.js"], {
    env: { ...process.env, FUGLE_API_KEY: "lifecycle-probe-not-a-secret", PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const started = await waitFor(`http://127.0.0.1:${port}/healthz`, 8000);
    assert.equal(started.status, "ok");
    child.kill("SIGTERM");
    const result = await new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    if (process.platform === "win32") {
      // Windows：child.kill("SIGTERM") 直接 TerminateProcess（無 POSIX signal handler 語意），
      // 程序確實結束，但沒有 graceful 結束碼；graceful 路徑由上方 IPC 測試覆蓋。
      assert.equal(result.code, null);
      assert.equal(result.signal, "SIGTERM");
    } else {
      // POSIX：SIGTERM 觸發 graceful shutdown → exit code 0。
      assert.equal(result.code, 0);
      assert.equal(result.signal, null);
    }
  } finally {
    child.kill("SIGKILL");
  }
});

async function waitFor(url, budgetMs) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    if (Date.now() - start > budgetMs) throw new Error("entrypoint did not serve /healthz in time");
    await new Promise((r) => setTimeout(r, 100));
  }
}
