import {validSymbol,failure,validTimestamp} from "./contract.js";
const ORIGIN="https://data-api.binance.vision";
const MAX_BYTES=128*1024;
// Cleanup must not mask the original failure or extend the request deadline.
function cancelBody(body){
  try{Promise.resolve(body?.cancel()).catch(()=>{});}catch{/* best-effort cleanup */}
}
async function boundedJson(response){
  if(!response.body)return failure("INVALID_RESPONSE");
  const reader=response.body.getReader(),decoder=new TextDecoder("utf-8",{fatal:true});
  let text="",size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>MAX_BYTES){cancelBody(reader);return failure("RESPONSE_TOO_LARGE")}
      text+=decoder.decode(value,{stream:true});
    }
    text+=decoder.decode();return {ok:true,data:JSON.parse(text)};
  }catch(e){return failure(e?.name==="TimeoutError"||e?.name==="AbortError"?"TIMEOUT":"INVALID_RESPONSE")}
  finally{reader.releaseLock()}
}
export function createBinanceRest({transport,now,timeoutMs=8000}){
  if(typeof transport!=="function"||typeof now!=="function"||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw new TypeError("Invalid public transport");
  let busy=false,blockedUntil=0,banned=false,lastObserved=0,clockInvalid=false;
  function sampleClock(){
    const value=now();
    if(!validTimestamp(value)||value<lastObserved){clockInvalid=true;return null;}
    lastObserved=value;
    return value;
  }
  async function request(path,params={}){
    if(banned)return failure("IP_BANNED");
    if(clockInvalid)return failure("INVALID_CLOCK");
    const current=sampleClock();
    if(current===null)return failure("INVALID_CLOCK");
    if(current<blockedUntil)return failure("RATE_LIMITED",blockedUntil-current);
    if(busy)return failure("BUSY");
    busy=true;
    try{
      const url=new URL(path,ORIGIN);url.search=new URLSearchParams(params).toString();
      const response=await transport(url,{method:"GET",redirect:"error",credentials:"omit",headers:{accept:"application/json"},signal:AbortSignal.timeout(timeoutMs)});
      if(response.status===418||response.status===429){
        const header=response.headers.get("retry-after");
        const wait=header&&/^\d{1,8}$/.test(header)?Number(header)*1000:60000;
        const retryAfterMs=Math.max(1000,wait),receivedAt=sampleClock();
        if(receivedAt===null||!validTimestamp(receivedAt+retryAfterMs))clockInvalid=true;
        else blockedUntil=receivedAt+retryAfterMs;
        if(response.status===418)banned=true;
        cancelBody(response.body);
        return failure(banned?"IP_BANNED":"RATE_LIMITED",retryAfterMs);
      }
      if(!response.ok){cancelBody(response.body);return failure("HTTP_"+response.status)}
      const result=await boundedJson(response);
      if(!result.ok)return result;
      const fetchedAt=sampleClock();
      return fetchedAt===null?failure("INVALID_CLOCK"):{...result,fetchedAt};
    }catch(e){return failure(e?.name==="TimeoutError"||e?.name==="AbortError"?"TIMEOUT":"NETWORK_ERROR")}
    finally{busy=false}
  }
  // Only these fixed public GET endpoints are exposed; no arbitrary URL, API key or order path.
  return Object.freeze({
    serverTime:()=>request("/api/v3/time"),
    latestTrade:symbol=>validSymbol(symbol)?request("/api/v3/aggTrades",{symbol,limit:"1"}):Promise.resolve(failure("UNSUPPORTED_SYMBOL"))
  });
}
