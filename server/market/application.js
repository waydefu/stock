import {SYMBOLS,validSymbol,normalizeTrade,checkClock,failure} from "./contract.js";
// Application service uses injected read-only ports. No automatic fallback or trade action.
export async function readMarketSnapshot({market,now,symbols=SYMBOLS}){
  if(!Array.isArray(symbols)||symbols.length<1||symbols.length>SYMBOLS.length||new Set(symbols).size!==symbols.length||!symbols.every(validSymbol))return failure("INVALID_WATCHLIST");
  const startedAt=now(),clock=await market.serverTime();
  if(!clock.ok)return clock;
  const checked=checkClock(clock.data?.serverTime,startedAt,clock.fetchedAt);
  if(!checked.ok)return checked;
  const results=[];
  for(const symbol of symbols){
    const r=await market.latestTrade(symbol);
    results.push({symbol,...(r.ok?normalizeTrade(symbol,r.data,r.fetchedAt):r)});
    if(!r.ok&&["RATE_LIMITED","IP_BANNED"].includes(r.code)){
      for(const remaining of symbols.slice(results.length))results.push({symbol:remaining,...failure(r.code,r.retryAfterMs)});
      break;
    }
  }
  return {ok:results.every(r=>r.ok),mode:"PUBLIC_READ_ONLY",results};
}
