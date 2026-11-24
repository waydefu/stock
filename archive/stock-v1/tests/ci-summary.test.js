import test from "node:test";
import assert from "node:assert/strict";
import { parseTestCounts, stripAnsi } from "../scripts/ci-summary-lib.js";

test("ci summary parses Node 24 info-symbol reporter", () => {
  const counts = parseTestCounts("ℹ tests 341\nℹ pass 341\nℹ fail 0\nℹ duration_ms 123.45\n");
  assert.deepEqual(counts, { tests: 341, pass: 341, fail: 0, skipped: 0, duration: 123.45 });
});

test("ci summary parses hash-prefixed reporter and explicit skipped", () => {
  const counts = parseTestCounts("# tests 10\n# pass 8\n# fail 1\n# skipped 1\n# duration_ms 20\n");
  assert.deepEqual(counts, { tests: 10, pass: 8, fail: 1, skipped: 1, duration: 20 });
});

test("ci summary strips ANSI and fails closed on incomplete output", () => {
  assert.equal(stripAnsi("\u001b[32mPASS\u001b[0m"), "PASS");
  const counts = parseTestCounts("\u001b[36mℹ tests 5\u001b[0m\n");
  assert.equal(counts.tests, 5);
  assert.equal(counts.pass, null);
  assert.equal(counts.fail, null);
  assert.equal(counts.skipped, null);
});
