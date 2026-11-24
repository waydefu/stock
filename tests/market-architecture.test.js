import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {posix} from "node:path";
import {WEB_ASSETS} from "../scripts/stage-web.js";
const graph={"server/market/contract.js":[],"server/market/application.js":["./contract.js"],"server/market/binance-rest.js":["./contract.js"]};
function check(path,source){
  assert.doesNotMatch(source,/\b(?:import\s*\(|require\s*\(|eval\s*\(|new\s+Function\b|process\.env|localStorage|document\b|window\b|globalThis\b)/);
  const imports=[];
  for(const line of source.split("\n")){
    if(/^\s*import\b/.test(line)||/^\s*export\b.*\bfrom\s*['"]/.test(line)){
      const m=line.match(/^\s*import\s+[^'";]+?\s+from\s+["'](\.[^"']+)["'];?\s*$/);
      assert.ok(m,"Unsupported import syntax: "+path);imports.push(m[1]);
    }
  }
  assert.deepEqual(imports,graph[path]);
  if(path!=="server/market/binance-rest.js")assert.doesNotMatch(source,/\b(?:fetch|WebSocket|XMLHttpRequest|Date\.now)\s*\(/);
}
test("market boundary inventory, imports, and frontend isolation",()=>{
  const files=readdirSync("server",{recursive:true,withFileTypes:true}).filter(e=>e.isFile()&&e.name.endsWith(".js")).map(e=>posix.join(e.parentPath.replaceAll("\\","/"),e.name)).sort();
  assert.deepEqual(files,Object.keys(graph).sort());
  for(const p of files)check(p,readFileSync(p,"utf8"));
  assert.ok(WEB_ASSETS.every(p=>!p.startsWith("server/")));
});
test("market contract rejects host I/O and adapter dependency",()=>{
  for(const source of ["fetch('x')","Date.now()","process.env.SECRET","import {createBinanceRest} from './binance-rest.js';"])assert.throws(()=>check("server/market/contract.js",source));
});
