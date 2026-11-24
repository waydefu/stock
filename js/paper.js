// Offline fixture only. Amounts are integer micro-USDT; no order API.
const safe = n => Number.isSafeInteger(n) && n >= 0;
const reject = code => ({ status: "REJECTED", code });
export function assess(intent, ctx) {
  if (!intent || !ctx || typeof intent !== "object" || typeof ctx !== "object") return reject("INVALID_INPUT");
  if (ctx.mode !== "PAPER" || ctx.source !== "FIXTURE") return reject("MODE_DENIED");
  if (intent.action === "HOLD") return {status:"NO_ACTION",code:"HOLD"};
  if (intent.action !== "OPEN_LONG" || !["BTCUSDT","ETHUSDT","SOLUSDT"].includes(intent.symbol)) return reject("UNSUPPORTED_INTENT");
  if (ctx.halted !== false) return reject("HALTED");
  if (ctx.reconciled !== true) return reject("ACCOUNT_UNVERIFIED");
  if (![ctx.now,ctx.quoteAt,intent.createdAt,intent.expiresAt].every(safe) || ctx.quoteAt > ctx.now || ctx.now-ctx.quoteAt>15000) return reject("STALE_QUOTE");
  if (intent.createdAt>ctx.now || intent.expiresAt<=ctx.now || intent.expiresAt-intent.createdAt>60000) return reject("INTENT_EXPIRED");
  if (typeof intent.evidenceId!=="string" || !intent.evidenceId.trim()) return reject("MISSING_EVIDENCE");
  if (![ctx.equity,ctx.cash,ctx.positions,intent.notional,intent.stopBps].every(safe) || ctx.equity<=0 || ctx.cash>ctx.equity || intent.notional<=0 || intent.stopBps<=0 || intent.stopBps>10000 || ctx.equity>100000000000 || intent.notional>100000000000) return reject("INVALID_AMOUNTS");
  if(ctx.positions!==0) return reject("POSITION_LIMIT");
  const n=BigInt(intent.notional), e=BigInt(ctx.equity), c=BigInt(ctx.cash);
  const ceil=(a,b)=>(a+b-1n)/b;
  const cost=ceil(n*30n,10000n), loss=ceil(n*BigInt(intent.stopBps+60),10000n);
  if(n<5000000n || n*85n<500000000n) return reject("MIN_NOTIONAL_BUFFER");
  if(n*100n>e*60n) return reject("EXPOSURE_LIMIT");
  if(n+cost>c) return reject("CASH_LIMIT");
  if(loss*100n>e) return reject("RISK_BUDGET");
  return {status:"PAPER_ELIGIBLE",code:"GATE_PASS",loss:Number(loss),cost:Number(cost)};
}
export function fixture(scenario="normal") {
  const now=100000, intent={action:"OPEN_LONG",symbol:"BTCUSDT",notional:6000000,stopBps:200,createdAt:now,expiresAt:now+30000,evidenceId:"fixture-v1"};
  const context={mode:"PAPER",source:"FIXTURE",halted:false,reconciled:true,now,quoteAt:now,equity:30000000,cash:30000000,positions:0};
  if(scenario==="stale") context.quoteAt=0;
  else if(scenario==="risk") intent.stopBps=900;
  else if(scenario==="halt") context.halted=true;
  else if(scenario!=="normal") return reject("UNKNOWN_FIXTURE");
  return assess(intent,context);
}
