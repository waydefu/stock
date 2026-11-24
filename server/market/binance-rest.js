import {validSymbol,failure} from "./contract.js";
const ORIGIN="https://data-api.binance.vision";
const MAX_BYTES=128*1024;
async function boundedJson(response){
  if(!response.body)return failure("INVALID_RESPONSE");
  const reader=response.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true});
  let text="",size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES){await reader.cancel();return failure("RESPONSE_TOO_LARGE")}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();return {ok:true,data:JSON.parse(text)};
  }catch(e){return failure(e?.name==="TimeoutError"||e?.name==="AbortError"?"TIMEOUT":"INVALID_RESPONSE")}
  finally{reader.releaseLock()}
}
export function createBinanceRest({transport,now,timeoutMs=8000}){
  if(typeof transport!=="function"||typeof now!=="function"||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw new TypeError("Invalid public transport");
  let busy=false,blockedUntil=0,banned=false;
  async function request(path,params={}){
    if(banned)return failure("IP_BANNED");
    const current=now();
    if(!Number.isSafeInteger(current)||current<0)return failure("INVALID_CLOCK");
    if(current<blockedUntil)return failure("RATE_LIMITED",blockedUntil-current);
    if(busy)return failure("BUSY");
    busy=true;
    try{
      const url=new URL(path,ORIGIN);url.search=new URLSearchParams(params).toString();
      const response=await transport(url,{method:"GET",redirect:"error",credentials:"omit",headers:{accept:"application/json"},signal:AbortSignal.timeout(timeoutMs)});
      if(response.status===418||response.status===429){
        const header=response.headers.get("retry-after");
        const wait=header&&/^\d{1,8}$/.test(header)?Number(header)*1000:60000;
        blockedUntil=now()+Math.max(1000,wait);
        if(response.status===418)banned=true;
        await response.body?.cancel();
        return failure(banned?"IP_BANNED":"RATE_LIMITED",Math.max(1000,wait));
      }
      if(!response.ok){await response.body?.cancel();return failure("HTTP_"+response.status)}
      const result=await boundedJson(response);
      return result.ok?{...result,fetchedAt:now()}:result;
    }catch(e){return failure(e?.name==="TimeoutError"||e?.name==="AbortError"?"TIMEOUT":"NETWORK_ERROR")}
    finally{busy=false}
  }
  // Only these fixed public GET endpoints are exposed; no arbitrary URL, API key or order path.
  return Object.freeze({
    serverTime:()=>request("/api/v3/time"),
    latestTrade:symbol=>validSymbol(symbol)?request("/api/v3/aggTrades",{symbol,limit:"1"}):Promise.resolve(failure("UNSUPPORTED_SYMBOL"))
  });
}
