/* Pure parser for Node's built-in test runner summary.
   Keep CI presentation parsing isolated from git/GitHub side effects so it is testable. */
"use strict";

export function stripAnsi(text = "") {
  return String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

export function parseTestCounts(text = "") {
  const clean = stripAnsi(text);
  const pick = (label) => {
    const escaped = label.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`^\\s*(?:[#ℹ]\\s*)?${escaped}\\s+(\\d+(?:\\.\\d+)?)\\s*$`, "m").exec(clean);
    return match ? Number(match[1]) : null;
  };
  const tests = pick("tests");
  const pass = pick("pass");
  const fail = pick("fail");
  const skippedRaw = pick("skipped");
  return {
    tests,
    pass,
    fail,
    skipped: skippedRaw ?? (tests !== null && pass !== null && fail !== null ? Math.max(0, tests - pass - fail) : null),
    duration: pick("duration_ms"),
  };
}
