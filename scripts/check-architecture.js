import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {posix} from "node:path";
import {MODULES,MODULE_EDGES} from "./module-contract.js";
export function checkModule(path,source){
  assert.doesNotMatch(source,/\b(?:import\s*\(|require\s*\(|eval\s*\(|new\s+Function\b)/,"Dynamic loading forbidden: "+path);
  assert.doesNotMatch(source,/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/,"Offline network boundary: "+path);
  assert.doesNotMatch(source,/archive\/stock-v1/);
  if(/^js\/(domain|application)\//.test(path))assert.doesNotMatch(source,/\b(?:document|window|localStorage|sessionStorage|navigator|globalThis|process)\b/,"Pure layer must not use host APIs: "+path);
  // Static imports must occupy their own single line, using the project ESM convention.
  const imports=[];
  for(const line of source.split("\n")){
    if(/^\s*import\b/.test(line)||/^\s*export\b.*\bfrom\s*['"]/.test(line)){
      const match=line.match(/^\s*(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+)["'](\.[^"']+)["'];?\s*$/);
      assert.ok(match,"Unsupported import syntax: "+path);
      imports.push(posix.normalize(posix.join(posix.dirname(path),match[1])));
    }
  }
  assert.deepEqual([...new Set(imports)].sort(),[...MODULE_EDGES[path]].sort(),"Unexpected module edges: "+path);
}
export function checkArchitecture(){
  const files=readdirSync("js",{recursive:true,withFileTypes:true}).filter(x=>x.isFile()&&x.name.endsWith(".js")).map(x=>posix.join(x.parentPath.replaceAll("\\","/"),x.name)).sort();
  assert.deepEqual(files,[...MODULES].sort(),"Unregistered runtime module");
  for(const path of MODULES)checkModule(path,readFileSync(path,"utf8"));
  // Cycle check on declared graph.
  const seen=new Set(),stack=new Set();
  function visit(p){assert.ok(!stack.has(p),"Dependency cycle: "+p);if(seen.has(p))return;stack.add(p);for(const d of MODULE_EDGES[p])visit(d);stack.delete(p);seen.add(p)}
  for(const p of MODULES)visit(p);
}
checkArchitecture();
console.log("architecture contract PASS");
