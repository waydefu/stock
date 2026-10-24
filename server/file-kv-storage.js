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
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

export const FILE_STORAGE_VERSION = 1;

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
        throw new Error(`durable storage 無法讀取／解析：${error.message}`);
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
    const fd = openSync(tempPath, "w", 0o600);
    try {
      writeFileSync(fd, payload, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tempPath, this.#filePath);
  }
}
