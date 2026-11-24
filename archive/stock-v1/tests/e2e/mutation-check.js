/* 突變驗證（Track C1 驗收）：把 R-023 的 bug 重新放回程式碼，確認 E2E 真的會紅。
   這是「E2E 有沒有守住核心流程」的證據——沒有這一步，E2E 可能只是裝飾。
   流程：備份 → 突變 referencePrice → 跑 E2E（必須失敗）→ 還原 → 確認檔案一致。
   用法：node tests/e2e/mutation-check.js */
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const TARGET = resolve(ROOT, "js/order-candidate.js");
const BACKUP = resolve(ROOT, "js/order-candidate.e2e-backup.js");
const SOURCE_LINE = "if (Number.isFinite(referencePrice) && referencePrice > 0) candidate.referencePrice = referencePrice;";
const MUTATED_LINE = "/* E2E MUTATION: referencePrice intentionally dropped (R-023 replay) */";

async function runE2E() {
  return new Promise((done) => {
    const child = spawn(process.execPath, [resolve(ROOT, "tests/e2e/run-e2e.js")], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("exit", (code) => done({ code, output }));
  });
}

async function main() {
  const original = await readFile(TARGET, "utf8");
  if (!original.includes(SOURCE_LINE)) {
    console.error("MUTATION FAIL：找不到要突變的程式碼（js/order-candidate.js 已改變，請更新本腳本）");
    process.exit(1);
  }
  await copyFile(TARGET, BACKUP);
  let mutatedExit = null;
  try {
    await writeFile(TARGET, original.replace(SOURCE_LINE, MUTATED_LINE), "utf8");
    const result = await runE2E();
    mutatedExit = result.code;
    if (result.code === 0) {
      console.error("MUTATION FAIL：突變後 E2E 仍然全綠——E2E 沒有守住核心流程（R-023 回歸）");
      console.error(result.output);
      process.exitCode = 1;
      return;
    }
    console.log(`ok  - 突變後 E2E 如期變紅（exit code ${result.code}）`);
  } finally {
    await writeFile(TARGET, original, "utf8");
    await copyFile(BACKUP, TARGET);
    const { rm } = await import("node:fs/promises");
    await rm(BACKUP, { force: true });
    const restored = await readFile(TARGET, "utf8");
    if (restored !== original) {
      console.error("MUTATION FAIL：還原後檔案與原始內容不一致");
      process.exitCode = 1;
      return;
    }
    console.log("ok  - 突變已完全還原");
  }
  const after = await runE2E();
  if (after.code !== 0) {
    console.error("MUTATION FAIL：還原後 E2E 仍失敗，環境本身有問題");
    console.error(after.output);
    process.exitCode = 1;
    return;
  }
  console.log("ok  - 還原後 E2E 全綠");
  process.exit(process.exitCode ?? 0);
}

await main();
