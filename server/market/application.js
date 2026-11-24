import {SYMBOLS,validSymbol,normalizeTrade,checkClock,failure,validTimestamp} from "./contract.js";

// A snapshot owns its watchlist and publishes only observations within its clock bounds.
export async function readMarketSnapshot({market,now,symbols=SYMBOLS}){
  if(!Array.isArray(symbols)||symbols.length<1||symbols.length>SYMBOLS.length)return failure("INVALID_WATCHLIST");
  const watchlist=[...symbols];
  if(new Set(watchlist).size!==watchlist.length||!watchlist.every(validSymbol))return failure("INVALID_WATCHLIST");
  let lastObserved=now();
  if(!validTimestamp(lastObserved))return failure("INVALID_CLOCK");
  const startedAt=lastObserved;
  const sampleClock=()=>{
    const value=now();
    if(!validTimestamp(value)||value<lastObserved)return null;
    lastObserved=value;
    return value;
  };
  const clock=await market.serverTime();
  const clockReceivedAt=sampleClock();
  if(clockReceivedAt===null)return failure("INVALID_CLOCK");
  if(!clock||typeof clock.ok!=="boolean")return failure("INVALID_RESPONSE");
  if(!clock.ok)return failure(clock.code,clock.retryAfterMs);
  if(!validTimestamp(clock.fetchedAt)||clock.fetchedAt>clockReceivedAt)return failure("INVALID_CLOCK");
  const checked=checkClock(clock.data?.serverTime,startedAt,clockReceivedAt);
  if(!checked.ok)return checked;
  if(clock.fetchedAt<startedAt)return failure("INVALID_CLOCK");

  const results=[];
  for(const symbol of watchlist){
    const requestedAt=sampleClock();
    if(requestedAt===null)return failure("INVALID_CLOCK");
    const r=await market.latestTrade(symbol);
    const receivedAt=sampleClock();
    if(receivedAt===null)return failure("INVALID_CLOCK");
    if(!r||typeof r.ok!=="boolean")return failure("INVALID_RESPONSE");
    if(r.ok&&(!validTimestamp(r.fetchedAt)||r.fetchedAt<requestedAt||r.fetchedAt>receivedAt))return failure("INVALID_CLOCK");
    results.push({symbol,...(r.ok?normalizeTrade(symbol,r.data,r.fetchedAt):failure(r.code,r.retryAfterMs))});
    if(!r.ok&&["RATE_LIMITED","IP_BANNED"].includes(r.code)){
      for(const remaining of watchlist.slice(results.length))results.push({symbol:remaining,...failure(r.code,r.retryAfterMs)});
      break;
    }
  }
  const evaluatedAt=sampleClock();
  if(evaluatedAt===null||!validTimestamp(evaluatedAt+checked.uncertaintyMs))return failure("INVALID_CLOCK");
  const conservativeNow=evaluatedAt+checked.uncertaintyMs;
  const finalResults=results.map(r=>r.ok&&conservativeNow>=r.evidence.expiresAt?{symbol:r.symbol,...failure("STALE_AT_SNAPSHOT")}:r);
  return {ok:finalResults.every(r=>r.ok),mode:"PUBLIC_READ_ONLY",evaluatedAt,clockUncertaintyMs:checked.uncertaintyMs,results:finalResults};
}
