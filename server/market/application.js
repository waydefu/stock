import {SYMBOLS,validSymbol,normalizeTrade,checkClock,failure} from "./contract.js";
// Application service uses injected read-only ports. No automatic fallback or trade action.
export async function readMarketSnapshot({market,now,symbols=SYMBOLS}){
  if(!Array.isArray(symbols)||symbols.length<1||symbols.length>SYMBOLS.length||new Set(symbols).size!==symbols.length||!symbols.every(validSymbol))return failure("INVALID_WATCHLIST");
  const startedAt=now(),clock=await market.serverTime();
  if(!clock.ok)return clock;
  const checked=checkClock(clock.data?.serverTime,startedAt,clock.fetchedAt);
  if(!checked.ok)return checked;
  const results=[];
  let lastObserved=clock.fetchedAt;
  for(const symbol of symbols){
    const r=await market.latestTrade(symbol);
    if(r.ok){
      if(!Number.isSafeInteger(r.fetchedAt)||r.fetchedAt<lastObserved)return failure("INVALID_CLOCK");
      lastObserved=r.fetchedAt;
    }
    results.push({symbol,...(r.ok?normalizeTrade(symbol,r.data,r.fetchedAt):r)});
    if(!r.ok&&["RATE_LIMITED","IP_BANNED"].includes(r.code)){
      for(const remaining of symbols.slice(results.length))results.push({symbol:remaining,...failure(r.code,r.retryAfterMs)});
      break;
    }
  }
  const evaluatedAt=now();
  if(!Number.isSafeInteger(evaluatedAt)||evaluatedAt<lastObserved)return failure("INVALID_CLOCK");
  const conservativeNow=evaluatedAt+checked.uncertaintyMs;
  const finalResults=results.map(r=>r.ok&&conservativeNow>=r.evidence.expiresAt?{symbol:r.symbol,...failure("STALE_AT_SNAPSHOT")}:r);
  return {ok:finalResults.every(r=>r.ok),mode:"PUBLIC_READ_ONLY",evaluatedAt,clockUncertaintyMs:checked.uncertaintyMs,results:finalResults};
}
