/* Synchronous durable key-value adapter for server-side PaperBroker/Risk/Audit.
   Intended ONLY for an explicitly confirmed persistent mount.
   Each mutation writes a complete JSON snapshot via temp-file + fsync + atomic rename. */
"use strict";

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";

export const FILE_STORAGE_VERSION = 1;

export class DurableStorageError extends Error {
  constructor(message, cause = null) {
    super(message);
    this.name = "DurableStorageError";
    this.code = "DURABLE_STORAGE_FAILED";
    this.cause = cause;
  }
}

function emptyPayload() {
  return { version: FILE_STORAGE_VERSION, values: {} };
}

function validatePayload(payload, filePath) {
  if (!payload || payload.version !== FILE_STORAGE_VERSION || !payload.values || typeof payload.values !== "object" || Array.isArray(payload.values)) {
    throw new Error(`durable storage 格式損壞：${filePath}`);
  }
  for (const [key, value] of Object.entries(payload.values)) {
    if (typeof key !== "string" || typeof value !== "string") throw new Error(`durable storage value 非字串：${key}`);
  }
  return payload;
}


export function acquireExclusiveFileLease(filePath, {
  now = () => new Date().toISOString(),
  pid = process.pid,
  token = randomUUID(),
} = {}) {
  if (typeof filePath !== "string" || !filePath || !isAbsolute(filePath)) {
    throw new Error("AUTO_PAPER_STATE_FILE 必須是絕對路徑");
  }
  const resolved = resolve(filePath);
  mkdirSync(dirname(resolved), { recursive: true });
  const lockPath = `${resolved}.lock`;
  let fd = null;
  try {
    fd = openSync(lockPath, "wx", 0o600);
    writeFileSync(fd, JSON.stringify({
      version: 1,
      token,
      pid,
      acquiredAt: now(),
      stateFile: resolved,
    }), "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
  } catch (error) {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* best effort */ }
    }
    if (error?.code === "EEXIST") {
      const locked = new Error(`Auto Paper durable state 已被另一個 instance 鎖定：${lockPath}`);
      locked.code = "DURABLE_STORAGE_LOCKED";
      throw locked;
    }
    throw new DurableStorageError(`durable storage lease failed: ${error?.message ?? "unknown"}`, error);
  }

  let released = false;
  return Object.freeze({
    lockPath,
    release() {
      if (released) return false;
      let owner;
      try {
        owner = JSON.parse(readFileSync(lockPath, "utf8"));
      } catch (error) {
        throw new DurableStorageError(`durable storage lease 無法驗證：${error?.message ?? "unknown"}`, error);
      }
      if (owner?.token !== token) {
        const mismatch = new Error("durable storage lease owner mismatch；拒絕刪除他人的 lock");
        mismatch.code = "DURABLE_STORAGE_LOCKED";
        throw mismatch;
      }
      try {
        unlinkSync(lockPath);
        released = true;
        return true;
      } catch (error) {
        throw new DurableStorageError(`durable storage lease release failed: ${error?.message ?? "unknown"}`, error);
      }
    },
  });
}

export class FileKeyValueStorage {
  #filePath;
  #values;

  constructor(filePath) {
    if (typeof filePath !== "string" || !filePath || !isAbsolute(filePath)) {
      throw new Error("AUTO_PAPER_STATE_FILE 必須是絕對路徑");
    }
    this.#filePath = resolve(filePath);
    mkdirSync(dirname(this.#filePath), { recursive: true });
    if (existsSync(this.#filePath)) {
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(this.#filePath, "utf8"));
      } catch (error) {
        throw new DurableStorageError(`durable storage 無法讀取／解析：${error.message}`, error);
      }
      this.#values = { ...validatePayload(parsed, this.#filePath).values };
    } else {
      this.#values = {};
      this.#flush();
    }
  }

  getItem(key) {
    const clean = String(key);
    return Object.hasOwn(this.#values, clean) ? this.#values[clean] : null;
  }

  setItem(key, value) {
    this.#values[String(key)] = String(value);
    this.#flush();
  }

  removeItem(key) {
    delete this.#values[String(key)];
    this.#flush();
  }

  describe() {
    return Object.freeze({ kind: "atomic-json-file", filePath: this.#filePath, version: FILE_STORAGE_VERSION });
  }

  #flush() {
    const payload = JSON.stringify({ version: FILE_STORAGE_VERSION, values: this.#values });
    const tempPath = `${this.#filePath}.tmp`;
    let fd = null;
    try {
      fd = openSync(tempPath, "w", 0o600);
      writeFileSync(fd, payload, "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tempPath, this.#filePath);
    } catch (error) {
      if (fd !== null) {
        try { closeSync(fd); } catch { /* best effort */ }
      }
      throw new DurableStorageError(`durable storage write failed: ${error?.message ?? "unknown"}`, error);
    }
  }
}
