import test from "node:test";
import assert from "node:assert/strict";
import {flowSnapshot,NODE_IDS} from "../js/application/flow.js";
import {fixture} from "../js/application/fixture.js";
test("architecture view is entirely offline",()=>{
  const s=flowSnapshot();assert.equal(s.verified,0);assert.equal(s.fixtureRuns,0);
  assert.deepEqual(Object.keys(s.nodes),NODE_IDS);assert.ok(Object.values(s.nodes).every(n=>n.state==="off"));
});
test("all scenarios distinguish risk, executor and independent audit",()=>{
  for(const [scenario,state] of [["normal","ok"],["stale","rejected"],["risk","rejected"],["halt","rejected"],["unknown","error"]]){
    const s=flowSnapshot(fixture(scenario));assert.equal(s.nodes.risk.state,state);assert.equal(s.nodes.execution.state,"blocked");
    assert.equal(s.nodes.audit.state,"off");assert.equal(s.nodes.audit.reason,"NO_AUDIT_SERVICE");
    assert.equal(s.verified,0);assert.equal(s.fixtureRuns,1);
  }
});
test("unexpected or inconsistent results fail closed",()=>{
  for(const result of [{},{status:"REJECTED",code:"GATE_PASS"},{status:"PAPER_ELIGIBLE",code:"HALTED"}]){
    const s=flowSnapshot(result);assert.equal(s.nodes.risk.state,"error");assert.equal(s.nodes.execution.reason,"RISK_FAILURE");
  }
});
test("projection has no shared mutable state",()=>{const s=flowSnapshot();s.nodes.market.state="ok";assert.equal(flowSnapshot().nodes.market.state,"off")});
