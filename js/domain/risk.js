// Pure offline risk policy. Integer micro-USDT; no DOM, I/O or execution.
const safe = n => Number.isSafeInteger(n) && n >= 0;
const reject = code => ({ status: "REJECTED", code });
// Accept only data records, not inherited fields, arrays or executable getters.
const record = value => {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) &&
    Object.values(Object.getOwnPropertyDescriptors(value)).every(d => Object.hasOwn(d, "value"));
};
const owns = (value, fields) => fields.every(field => Object.hasOwn(value, field));
export function assess(intent, ctx) {
  if (!record(intent) || !record(ctx) || !owns(intent, ["action"]) || !owns(ctx, ["mode","source"])) return reject("INVALID_INPUT");
  if (ctx.mode !== "PAPER" || ctx.source !== "FIXTURE") return reject("MODE_DENIED");
  if (intent.action === "HOLD") return {status:"NO_ACTION",code:"HOLD"};
  if (!owns(intent, ["symbol","createdAt","expiresAt","evidenceId","notional","stopBps"]) ||
      !owns(ctx, ["halted","reconciled","now","quoteAt","equity","cash","positions"])) return reject("INVALID_INPUT");
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
  // Each leg and stop amount rounds upward independently; never round total down.
  const cost=ceil(n*30n,10000n), loss=ceil(n*BigInt(intent.stopBps),10000n)+2n*cost;
  if(n*85n<500000000n) return reject("MIN_NOTIONAL_BUFFER");
  if(n*100n>e*60n) return reject("EXPOSURE_LIMIT");
  if(n+cost>c) return reject("CASH_LIMIT");
  if(loss*100n>e) return reject("RISK_BUDGET");
  return {status:"PAPER_ELIGIBLE",code:"GATE_PASS",loss:Number(loss),cost:Number(cost)};
}
