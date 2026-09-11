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

test("entrypoint boots, serves health, and shuts down on SIGTERM", async () => {
  const port = 18287;
  const child = spawn(process.execPath, ["server/start-market-proxy.js"], {
    env: { ...process.env, FUGLE_API_KEY: "lifecycle-probe-not-a-secret", PORT: String(port), HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const started = await waitFor(`http://127.0.0.1:${port}/healthz`, 8000);
    assert.equal(started.status, "ok");
    child.kill("SIGTERM");
    const code = await new Promise((resolve) => child.once("exit", resolve));
    assert.equal(code, 0);
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
