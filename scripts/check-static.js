import {readFileSync,existsSync} from "node:fs";import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
for(const p of ["index.html","css/styles.css","js/app.js","js/paper.js","AGENTS.md","GOVERNANCE.md","docs/TOOLS.md","docs/PROJECT_STATUS.md","archive/stock-v1/package.json","archive/stock-v1/tests"])assert.ok(existsSync(p),p);
for(const p of ["js/app.js","js/paper.js"]){const s=readFileSync(p,"utf8");assert.doesNotMatch(s,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/);assert.doesNotMatch(s,/archive\/stock-v1/)}
const archived=execFileSync("git",["rev-parse","HEAD:archive/stock-v1"],{encoding:"utf8"}).trim();
assert.equal(archived,"e4c11beff01ec905baa59b156005b16fdcb90396","Archive tree must match frozen original");
assert.equal(execFileSync("git",["status","--porcelain","--untracked-files=all","--","archive/stock-v1"],{encoding:"utf8"}).trim(),"","Archive worktree modified");
console.log("active static + frozen archive PASS");
