import {readFileSync,existsSync} from "node:fs";import assert from "node:assert/strict";
for(const p of ["index.html","css/styles.css","js/app.js","js/paper.js","AGENTS.md","GOVERNANCE.md","docs/TOOLS.md","docs/PROJECT_STATUS.md","archive/stock-v1/package.json","archive/stock-v1/tests"])assert.ok(existsSync(p),p);
for(const p of ["js/app.js","js/paper.js"]){const s=readFileSync(p,"utf8");assert.doesNotMatch(s,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/);assert.doesNotMatch(s,/archive\/stock-v1/)}
console.log("active static PASS");
