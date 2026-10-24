import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileKeyValueStorage, acquireExclusiveFileLease } from "../server/file-kv-storage.js";

function tempPath(name = "state.json") {
  const dir = mkdtempSync(join(tmpdir(), "stock-auto-paper-"));
  return { dir, file: join(dir, name) };
}

test("file storage persists string values across process-like reopen", () => {
  const t = tempPath();
  try {
    const first = new FileKeyValueStorage(t.file);
    first.setItem("paper", JSON.stringify({ cash: 123 }));
    first.setItem("audit", "ok");
    const second = new FileKeyValueStorage(t.file);
    assert.equal(second.getItem("paper"), JSON.stringify({ cash: 123 }));
    assert.equal(second.getItem("audit"), "ok");
    second.removeItem("audit");
    const third = new FileKeyValueStorage(t.file);
    assert.equal(third.getItem("audit"), null);
    assert.equal(JSON.parse(readFileSync(t.file, "utf8")).version, 1);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test("file storage fails closed on corrupt state instead of resetting paper authority", () => {
  const t = tempPath();
  try {
    writeFileSync(t.file, "{broken", "utf8");
    assert.throws(() => new FileKeyValueStorage(t.file), /無法讀取／解析/);
    writeFileSync(t.file, JSON.stringify({ version: 99, values: {} }), "utf8");
    assert.throws(() => new FileKeyValueStorage(t.file), /格式損壞/);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test("file storage rejects relative paths", () => {
  assert.throws(() => new FileKeyValueStorage("./paper-state.json"), /絕對路徑/);
});


test("exclusive durable-state lease rejects a second server writer and releases cleanly", () => {
  const t = tempPath();
  try {
    const first = acquireExclusiveFileLease(t.file, { token: "owner-a", pid: 111, now: () => "2026-10-25T00:00:00.000Z" });
    assert.throws(
      () => acquireExclusiveFileLease(t.file, { token: "owner-b", pid: 222 }),
      (error) => error?.code === "DURABLE_STORAGE_LOCKED",
    );
    assert.equal(first.release(), true);
    assert.equal(first.release(), false);
    const second = acquireExclusiveFileLease(t.file, { token: "owner-b", pid: 222 });
    assert.equal(second.release(), true);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test("lease owner mismatch refuses to delete another instance lock", () => {
  const t = tempPath();
  try {
    const lease = acquireExclusiveFileLease(t.file, { token: "owner-a", pid: 111 });
    writeFileSync(`${t.file}.lock`, JSON.stringify({ version: 1, token: "owner-b" }), "utf8");
    assert.throws(
      () => lease.release(),
      (error) => error?.code === "DURABLE_STORAGE_LOCKED",
    );
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});
