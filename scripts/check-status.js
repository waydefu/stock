// STATUS 同步門禁（Track C3 調整）：
// - 觸發範圍（任一）：js/ tests/ server/ scripts/ package.json index.html css/ .github/workflows/
// - 改了程式／測試／閘門的 PR 必須同步 docs/PROJECT_STATUS.md（讓作者重新檢視 scope／gaps）。
// - STATUS 不得再手寫會過期的數字（HEAD／測試數／閘門數）：那些改由 CI job summary 自動產生。
// - STATUS 必須保留三個固定段落：Scope、Known gaps、Enforcement。
// - push 到 main（無 base ref）直接通過：合併前 PR 階段已把關。
// 用法：node scripts/check-status.js [--base <branch>]（CI 由 npm run check:status 呼叫）
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TRIGGER_PREFIXES = ["js/", "tests/", "server/", "scripts/", "package.json", "index.html", "css/", ".github/workflows/"];
const EXEMPT_PREFIXES = ["docs/", "README.md", "DISCLAIMER.md", "IDEA.md"];
const STATUS_FILE = "docs/PROJECT_STATUS.md";
const REQUIRED_SECTIONS = ["## Scope", "## Known gaps", "## Enforcement"];
/* 會過期、必須改由 CI 自動產生的寫法（禁止再手寫）。 */
const STALE_PATTERNS = [
  { re: /Last verified main checkpoint/i, hint: "Last verified main checkpoint（HEAD 由 CI 產生）" },
  { re: /Tests[：:]\s*\d+\s*\/\s*\d+/, hint: "測試數量（由 CI job summary 產生）" },
  { re: /check:ui\s*\d+\s*\/\s*\d+/i, hint: "check:ui 數量（由 CI job summary 產生）" },
  { re: /Last verified[^\n]*\b[0-9a-f]{7,40}\b/i, hint: "手寫 commit SHA（由 CI 產生）" },
];

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
    const out = sh(`git diff --name-only origin/${base}..${head}`);
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

/* STATUS 內容檢查：段落齊全 + 沒有會過期的手寫數字。 */
function checkStatusContent() {
  let text;
  try {
    text = readFileSync(STATUS_FILE, "utf8");
  } catch {
    console.error(`CHECK-STATUS FAIL：找不到 ${STATUS_FILE}`);
    return false;
  }
  const problems = [];
  for (const section of REQUIRED_SECTIONS) {
    if (!text.includes(section)) problems.push(`缺段落「${section.replace(/^## /, "")}」`);
  }
  for (const { re, hint } of STALE_PATTERNS) {
    if (re.test(text)) problems.push(`仍手寫過期數字：${hint}`);
  }
  if (problems.length > 0) {
    console.error(`CHECK-STATUS FAIL：${STATUS_FILE} 內容不符 C3 契約`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return false;
  }
  return true;
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
  const contentOk = checkStatusContent();
  if (!contentOk) process.exit(1);
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
