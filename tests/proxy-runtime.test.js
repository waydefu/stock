import assert from "node:assert/strict";
import test from "node:test";
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
