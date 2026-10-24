/* Read-only Forward Test report.
   Usage:
     AUTO_PAPER_STATE_FILE=/persistent/stock-auto-paper.json npm run report:auto
     npm run report:auto -- /persistent/stock-auto-paper.json
*/
"use strict";

import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { ForwardTestJournal } from "../server/forward-test-journal.js";
import { FileKeyValueStorage } from "../server/file-kv-storage.js";

function resolveStateFile(argv = process.argv, env = process.env) {
  const raw = argv[2] || env.AUTO_PAPER_STATE_FILE || "";
  if (!raw) throw new Error("請提供 AUTO_PAPER_STATE_FILE 或第一個參數");
  const file = resolve(raw);
  if (!isAbsolute(raw)) throw new Error("state file 必須是絕對路徑");
  if (!existsSync(file)) throw new Error(`找不到 state file：${file}`);
  return file;
}

export function buildForwardTestReport({ stateFile }) {
  const storage = new FileKeyValueStorage(stateFile);
  const journal = new ForwardTestJournal({ storage });
  const entries = journal.entries();
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    stateFile,
    summary: journal.summary(),
    latest: entries.at(-1) ?? null,
  });
}

function main() {
  try {
    const stateFile = resolveStateFile();
    const report = buildForwardTestReport({ stateFile });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    console.error(`AUTO PAPER REPORT FAIL：${error?.message ?? "unknown"}`);
    process.exitCode = 1;
  }
}

const invokedDirectly = typeof process.argv[1] === "string" && process.argv[1].endsWith("report-auto-paper.js");
if (invokedDirectly) main();

export { resolveStateFile };
