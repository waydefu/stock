import test from "node:test";import assert from "node:assert/strict";import {assess,fixture} from "../js/paper.js";
const base={action:"OPEN_LONG",symbol:"BTCUSDT",notional:6000000,stopBps:200,createdAt:1000,expiresAt:2000,evidenceId:"fixture"};
const ctx={mode:"PAPER",source:"FIXTURE",halted:false,reconciled:true,now:1000,quoteAt:1000,equity:30000000,cash:30000000,positions:0};
test("fixture pass and adverse cases",()=>{assert.equal(fixture().status,"PAPER_ELIGIBLE");assert.equal(fixture().loss,156000);assert.equal(fixture("stale").code,"STALE_QUOTE");assert.equal(fixture("risk").code,"RISK_BUDGET");assert.equal(fixture("halt").code,"HALTED")});
for(const [name,intent,context,code] of [
["live",{}, {mode:"LIVE"},"MODE_DENIED"],["feed",{}, {source:"LIVE"},"MODE_DENIED"],["unknown account",{}, {reconciled:false},"ACCOUNT_UNVERIFIED"],["future quote",{}, {quoteAt:1001},"STALE_QUOTE"],["expired",{expiresAt:1000},{},"INTENT_EXPIRED"],["no evidence",{evidenceId:""},{},"MISSING_EVIDENCE"],["fraction",{notional:6000000.1},{},"INVALID_AMOUNTS"],["dust",{notional:5000000},{},"MIN_NOTIONAL_BUFFER"],["over exposure",{notional:19000000},{},"EXPOSURE_LIMIT"],["insufficient cash",{}, {cash:6000000},"CASH_LIMIT"],["existing position",{}, {positions:1},"POSITION_LIMIT"],["short not supported",{action:"OPEN_SHORT"},{},"UNSUPPORTED_INTENT"],["hold",{action:"HOLD"},{},"HOLD"]])test(name,()=>assert.equal(assess({...base,...intent},{...ctx,...context}).code,code));
test("deterministic/no state mutation",()=>{const i=Object.freeze({...base}),c=Object.freeze({...ctx});assert.deepEqual(assess(i,c),assess(i,c));assert.equal(c.cash,30000000)});
test("reject malformed and inherited input without invoking getters",()=>{
  const inherited=Object.create(base);
  const accessor={...base,get notional(){throw new Error("getter executed")}};
  for(const value of [null,[],inherited,accessor])assert.equal(assess(value,ctx).code,"INVALID_INPUT");
  const missing={...base};delete missing.notional;
  assert.equal(assess(missing,ctx).code,"INVALID_INPUT");
  const missingCtx={...ctx};delete missingCtx.positions;
  assert.equal(assess(base,missingCtx).code,"INVALID_INPUT");
});
test("freshness and intent expiry boundaries",()=>{
  assert.equal(assess({...base,createdAt:16000,expiresAt:76000},{...ctx,now:16000,quoteAt:1000}).code,"GATE_PASS");
  assert.equal(assess({...base,createdAt:16001,expiresAt:76001},{...ctx,now:16001,quoteAt:1000}).code,"STALE_QUOTE");
  assert.equal(assess({...base,expiresAt:61001},ctx).code,"INTENT_EXPIRED");
  assert.equal(assess({...base,createdAt:1001},ctx).code,"INTENT_EXPIRED");
});
test("minimum notional buffer boundary and independent conservative rounding",()=>{
  assert.equal(assess({...base,notional:5882352},ctx).code,"MIN_NOTIONAL_BUFFER");
  assert.equal(assess({...base,notional:5882353},ctx).code,"GATE_PASS");
  const r=assess({...base,notional:6000001},ctx);
  assert.equal(r.code,"GATE_PASS");assert.equal(r.cost,18001);assert.equal(r.loss,156003);
});
test("unknown fixture and HOLD in denied mode",()=>{
  assert.equal(fixture("unknown").code,"UNKNOWN_FIXTURE");
  assert.equal(assess({action:"HOLD"},{...ctx,mode:"LIVE"}).code,"MODE_DENIED");
});
