// Public Spot trade evidence. No I/O, clocks, credentials or orders.
export const SYMBOLS=Object.freeze(["BTCUSDT","ETHUSDT","SOLUSDT"]);
export const SOURCE="binance-spot-public-rest";
export const MAX_AGE_MS=15000;
export const validTimestamp=v=>Number.isSafeInteger(v)&&v>=0;
const positiveDecimal=v=>typeof v==="string"&&v.length<=64&&/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(v)&&/[1-9]/.test(v);
export function validSymbol(symbol){return SYMBOLS.includes(symbol)}
export function failure(code,retryAfterMs=null){return {ok:false,code,retryAfterMs}}
export function normalizeTrade(symbol,rows,fetchedAt){
  if(!validSymbol(symbol))return failure("UNSUPPORTED_SYMBOL");
  if(!validTimestamp(fetchedAt)||!Array.isArray(rows)||rows.length!==1)return failure("INVALID_RESPONSE");
  const r=rows[0];
  if(!r||!validTimestamp(r.a)||!validTimestamp(r.f)||!validTimestamp(r.l)||r.f>r.l||!validTimestamp(r.T)||!validTimestamp(r.T+MAX_AGE_MS)||!positiveDecimal(r.p)||!positiveDecimal(r.q)||typeof r.m!=="boolean")return failure("INVALID_TRADE");
  if(r.T>fetchedAt)return failure("FUTURE_TRADE");
  if(fetchedAt-r.T>=MAX_AGE_MS)return failure("STALE_TRADE");
  return {ok:true,evidence:{schemaVersion:1,venue:"BINANCE",marketType:"SPOT",source:SOURCE,kind:"LAST_AGG_TRADE",symbol,sequence:String(r.a),eventAt:r.T,observedAt:r.T,fetchedAt,expiresAt:r.T+MAX_AGE_MS,quality:"FRESH",price:r.p,quantity:r.q,buyerMaker:r.m}};
}
export function checkClock(serverTime,startedAt,finishedAt){
  if(![serverTime,startedAt,finishedAt].every(validTimestamp)||finishedAt<startedAt)return failure("INVALID_CLOCK");
  const rtt=finishedAt-startedAt;
  const uncertaintyMs=Math.max(Math.abs(serverTime-startedAt),Math.abs(serverTime-finishedAt));
  if(rtt>2000||uncertaintyMs>2000)return failure("CLOCK_UNCERTAIN");
  return {ok:true,uncertaintyMs};
}
// A latest-trade REST snapshot is not a contiguous stream; gaps require resync, not fabricated trades.
const validSequenceEvidence=r=>r&&validSymbol(r.symbol)&&r.source===SOURCE&&
  typeof r.sequence==="string"&&/^(?:0|[1-9]\d{0,15})$/.test(r.sequence)&&Number.isSafeInteger(Number(r.sequence))&&
  validTimestamp(r.eventAt)&&positiveDecimal(r.price)&&positiveDecimal(r.quantity)&&typeof r.buyerMaker==="boolean";
export function compareSequence(previous,next){
  if(!validSequenceEvidence(previous)||!validSequenceEvidence(next)||previous.symbol!==next.symbol)return "INVALID_SEQUENCE";
  const a=BigInt(previous.sequence),b=BigInt(next.sequence);
  if(b<a||next.eventAt<previous.eventAt)return "OUT_OF_ORDER";
  if(b===a)return next.price===previous.price&&next.quantity===previous.quantity&&next.eventAt===previous.eventAt&&next.buyerMaker===previous.buyerMaker?"DUPLICATE":"CONFLICT";
  return b===a+1n?"NEXT":"GAP";
}
