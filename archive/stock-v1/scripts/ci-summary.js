/* CI job summary（Track C3）：把 HEAD、測試數字、各閘門結果寫進 GitHub job summary。
   目的：docs/PROJECT_STATUS.md 不再手寫會過期的數字，改由這裡自動產生。
   用法（workflow 內）：
     npm test 2>&1 | tee "$RUNNER_TEMP/test-output.txt"
     node scripts/ci-summary.js
   環境變數：
     GITHUB_STEP_SUMMARY  寫入位置（沒有就打到 stdout）
     TEST_OUTPUT_FILE     測試輸出檔（預設 $RUNNER_TEMP/test-output.txt）
   解析不到的數字一律寫「未知」，不猜。 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { parseTestCounts } from "./ci-summary-lib.js";

function sh(command) {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    return (error?.stdout ?? "").toString().trim() || "未知";
  }
}

function readTestOutput() {
  const file = process.env.TEST_OUTPUT_FILE ?? (process.env.RUNNER_TEMP ? `${process.env.RUNNER_TEMP}/test-output.txt` : null);
  if (!file || !existsSync(file)) return "";
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const head = sh("git rev-parse HEAD");
  const shortHead = sh("git rev-parse --short HEAD");
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  const commitSubject = sh("git log -1 --pretty=%s");
  const counts = parseTestCounts(readTestOutput());
  const gate = (name, command) => {
    let ok = false;
    try {
      execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      ok = true;
    } catch {
      ok = false;
    }
    return `| ${name} | ${ok ? "PASS" : "FAIL"} |`;
  };

  const lines = [
    "## CI 摘要（自動產生，勿手寫進文件）",
    "",
    `- HEAD：\`${shortHead}\`（${head}）`,
    `- 分支：\`${branch}\``,
    `- 提交訊息：${commitSubject}`,
    `- 測試：${counts.tests ?? "未知"} 個（pass ${counts.pass ?? "未知"}／fail ${counts.fail ?? "未知"}／skipped ${counts.skipped ?? "未知"}）${counts.duration ? `・${counts.duration} ms` : ""}`,
    "",
    "| 閘門 | 結果 |",
    "| --- | --- |",
    gate("check:syntax", "npm run check:syntax"),
    gate("check:static", "npm run check:static"),
    gate("check:ui", "npm run check:ui"),
    gate("check:status", "npm run check:status"),
    "",
  ];
  const output = lines.join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${output}\n`);
  }
  console.log(output);
}

main();
