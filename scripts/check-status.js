// STATUS 同步門禁：改程式／測試／閘門的 PR 必須同步 docs/PROJECT_STATUS.md，否則 CI fail。
// - 觸發範圍（任一）：js/ tests/ server/ scripts/ package.json index.html css/ .github/workflows/
// - 純文件 PR（只碰 docs/、README.md、DISCLAIMER.md、IDEA.md）豁免，由維護者判斷。
// - push 到 main（無 base ref）直接通過：合併前 PR 階段已把關。
// 用法：node scripts/check-status.js [--base <branch>]（CI 由 npm run check:status 呼叫）
import { execSync } from "node:child_process";

const TRIGGER_PREFIXES = ["js/", "tests/", "server/", "scripts/", "package.json", "index.html", "css/", ".github/workflows/"];
const EXEMPT_PREFIXES = ["docs/", "README.md", "DISCLAIMER.md", "IDEA.md"];
const STATUS_FILE = "docs/PROJECT_STATUS.md";

function sh(command) {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function changedFiles(base, head) {
  try {
    sh(`git fetch --no-tags --depth=1 origin ${base}`);
  } catch {
    console.log(`CHECK-STATUS SKIP：抓不到 base ${base}（非標準 PR 環境），改由人工確認 STATUS`);
    return null;
  }
  try {
    const out = sh(`git diff --name-only ${base}..${head}`);
    return out ? out.split("\n").map((line) => line.trim()).filter(Boolean) : [];
  } catch {
    console.log("CHECK-STATUS SKIP：無法計算 diff，改由人工確認 STATUS");
    return null;
  }
}

function needsStatusUpdate(files) {
  const touched = files.some((f) => TRIGGER_PREFIXES.some((p) => f === p || f.startsWith(p)));
  if (!touched) return false;
  const onlyExempt = files.length > 0 && files.every((f) => EXEMPT_PREFIXES.some((p) => f === p || f.startsWith(p)));
  return !onlyExempt;
}

function main() {
  const args = process.argv.slice(2);
  const baseFlag = args.indexOf("--base");
  const base = baseFlag >= 0 && args[baseFlag + 1] ? args[baseFlag + 1] : process.env.GITHUB_BASE_REF;
  if (!base) {
    console.log("CHECK-STATUS PASS：非 PR 事件（main push），合併前已把關");
    return;
  }
  const files = changedFiles(base, "HEAD");
  if (files === null) return;
  if (!needsStatusUpdate(files)) {
    console.log("CHECK-STATUS PASS：未觸及程式／測試／閘門");
    return;
  }
  if (files.includes(STATUS_FILE)) {
    console.log(`CHECK-STATUS PASS：${STATUS_FILE} 已同步`);
    return;
  }
  console.error(`CHECK-STATUS FAIL：本 PR 改了程式／測試／閘門，卻沒同步 ${STATUS_FILE}`);
  console.error("觸發檔案：", files.filter((f) => TRIGGER_PREFIXES.some((p) => f === p || f.startsWith(p))).join("、"));
  process.exit(1);
}

main();
