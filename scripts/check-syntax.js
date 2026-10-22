/* 跨平台語法檢查：走訪 js/ tests/ scripts/ 底下所有 .js，逐檔執行 `node --check`。
   取代原本依賴 find／xargs 的版本（Windows 無法使用，見 FUTURE_PLAN Track B4）。
   規則：每個 gate 都要能在 Windows 與 ubuntu 跑出同樣結果。 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOTS = Object.freeze(["js", "tests", "scripts"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", ".opencode"]);

function collectJsFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectJsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const files = ROOTS.flatMap((root) => collectJsFiles(resolve(root), []));
  if (files.length === 0) {
    console.error("SYNTAX FAIL：找不到任何 .js 檔案");
    process.exit(1);
  }
  const failures = [];
  for (const file of files) {
    try {
      execFileSync(process.execPath, ["--check", file], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const detail = [error.stdout?.toString(), error.stderr?.toString()].filter(Boolean).join("\n").trim();
      failures.push({ file: relative(process.cwd(), file), detail });
    }
  }
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`SYNTAX FAIL：${failure.file}`);
      if (failure.detail) console.error(failure.detail);
    }
    console.error(`SYNTAX FAIL：${failures.length}/${files.length} 檔案語法錯誤`);
    process.exit(1);
  }
  console.log(`Syntax check passed: ${files.length} files`);
}

main();
