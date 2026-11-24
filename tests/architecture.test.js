import test from "node:test";
import assert from "node:assert/strict";
import {checkGraph,checkModule,checkArchitecture} from "../scripts/check-architecture.js";
import {MODULE_EDGES} from "../scripts/module-contract.js";
test("production inventory and permitted directions",()=>checkArchitecture());
test("UI cannot acquire direct domain access even through the declared graph",()=>{
  assert.throws(()=>checkGraph({...MODULE_EDGES,"js/ui/flow.js":["js/domain/risk.js"]}),/Forbidden layer dependency/);
});
test("domain cannot import application, root or UI",()=>{
  for(const dependency of ["js/application/fixture.js","js/app.js","js/ui/dom.js"]){
    assert.throws(()=>checkGraph({...MODULE_EDGES,"js/domain/risk.js":[dependency]}),/Forbidden layer dependency/);
  }
});
test("cycle, unknown target and duplicate edges fail",()=>{
  assert.throws(()=>checkGraph({...MODULE_EDGES,"js/ui/dom.js":["js/ui/flow.js"]}),/Dependency cycle/);
  assert.throws(()=>checkGraph({...MODULE_EDGES,"js/ui/dom.js":["js/ui/missing.js"]}),/Unregistered dependency/);
  assert.throws(()=>checkGraph({...MODULE_EDGES,"js/ui/dom.js":["js/ui/router.js","js/ui/router.js"]}),/Duplicate dependency/);
});
test("pure layer rejects host access, dynamic loading and unexpected imports",()=>{
  for(const source of ["document.title","fetch('x')","import('./x.js')","import { $ } from '../ui/dom.js';"]){
    assert.throws(()=>checkModule("js/domain/risk.js",source));
  }
});
