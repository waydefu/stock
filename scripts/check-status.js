import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
const s=readFileSync("docs/PROJECT_STATUS.md","utf8");
for(const h of ["## Current","## Scope","## Known gaps","## Enforcement","無持續服務"])assert.ok(s.includes(h),h);
// Compare the complete PR against its base, not just the final commit.
const base=process.env.STATUS_BASE_SHA;
if(base && !/^0+$/.test(base)){
  assert.match(base,/^[a-f0-9]{40}$/);
  const changed=execFileSync("git",["diff","--name-only",base,"HEAD","--"],{encoding:"utf8"}).trim().split("\n");
  const runtime=changed.some(p=>/^(index\.html$|css\/|js\/|src-tauri\/|package(?:-lock)?\.json$|\.github\/workflows\/|scripts\/)/.test(p));
  if(runtime){
    assert.ok(changed.includes("docs/PROJECT_STATUS.md"),"Runtime/CI change requires status update");
    assert.ok(changed.includes("docs/RISK_REGISTER.md"),"Runtime/CI change requires risk review");
  }
}
console.log("status contract PASS");
