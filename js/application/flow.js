// Pure projection of an actual single risk-fixture result, not an execution engine.
export const NODE_IDS=Object.freeze(["market","news","event","ai","quant","risk","execution","audit"]);
export function flowSnapshot(result=null){
  const nodes=Object.fromEntries(NODE_IDS.map(id=>[id,{state:"off",reason:"UNCONNECTED"}]));
  if(result===null)return {mode:"architecture",verified:0,fixtureRuns:0,nodes};
  const known=["GATE_PASS","STALE_QUOTE","RISK_BUDGET","HALTED"];
  const passed=result.status==="PAPER_ELIGIBLE"&&result.code==="GATE_PASS";
  const rejected=result.status==="REJECTED"&&known.slice(1).includes(result.code);
  nodes.risk={state:passed?"ok":rejected?"rejected":"error",reason:passed||rejected?result.code:"UNEXPECTED_RESULT"};
  nodes.execution={state:"blocked",reason:passed?"NO_EXECUTOR":rejected?"POLICY_REJECTED":"RISK_FAILURE"};
  // Audit is independent of execution: a rejection also needs an audit event.
  nodes.audit={state:"off",reason:"NO_AUDIT_SERVICE"};
  return {mode:"fixture",verified:0,fixtureRuns:1,nodes};
}
