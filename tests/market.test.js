import test from "node:test";
import assert from "node:assert/strict";
import {normalizeTrade,checkClock,compareSequence} from "../server/market/contract.js";
import {createBinanceRest} from "../server/market/binance-rest.js";
import {readMarketSnapshot} from "../server/market/application.js";
const at=1700000000000, row={a:123,p:"63200.00000000",q:"0.00100000",f:5,l:6,T:at,m:false};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
test("trade evidence retains exact decimal strings, source, sequence and expiry",()=>{
  const r=normalizeTrade("BTCUSDT",[row],at+1);assert.equal(r.ok,true);
  assert.equal(r.evidence.price,row.p);assert.equal(r.evidence.quantity,row.q);assert.equal(r.evidence.sequence,"123");assert.equal(r.evidence.expiresAt,at+15000);
  assert.equal(r.evidence.kind,"LAST_AGG_TRADE");
});
test("invalid, stale and future data fail closed",()=>{
  for(const [rows,t,code] of [[[],at,"INVALID_RESPONSE"],[[row,row],at,"INVALID_RESPONSE"],[[{...row,p:1}],at,"INVALID_TRADE"],[[{...row,p:"0.0"}],at,"INVALID_TRADE"],[[{...row,a:Number.MAX_SAFE_INTEGER+1}],at,"INVALID_TRADE"],[[row],at-1,"FUTURE_TRADE"],[[row],at+15001,"STALE_TRADE"]])assert.equal(normalizeTrade("BTCUSDT",rows,t).code,code);
  assert.equal(normalizeTrade("DOGEUSDT",[row],at).code,"UNSUPPORTED_SYMBOL");
  assert.equal(checkClock(at,at-3000,at).code,"CLOCK_UNCERTAIN");assert.equal(checkClock(at+3000,at,at).code,"CLOCK_UNCERTAIN");
});
test("sequence anomalies are distinguishable",()=>{
  const a=normalizeTrade("BTCUSDT",[row],at).evidence;
  for(const [seq,code] of [["123","DUPLICATE"],["124","NEXT"],["125","GAP"],["122","OUT_OF_ORDER"]])assert.equal(compareSequence(a,{...a,sequence:seq}),code);
  assert.equal(compareSequence(a,{...a,price:"1"}),"CONFLICT");
});
test("REST adapter exposes fixed public GETs only and never adds credentials",async()=>{
  const calls=[],market=createBinanceRest({now:()=>at,transport:async(url,opts)=>{calls.push([url.href,opts]);return json(url.pathname.endsWith("/time")?{serverTime:at}:[row])}});
  const r=await readMarketSnapshot({market,now:()=>at});
  assert.equal(r.ok,true);assert.equal(r.results.length,3);
  assert.deepEqual(calls.map(c=>c[0]),["https://data-api.binance.vision/api/v3/time",...["BTCUSDT","ETHUSDT","SOLUSDT"].map(s=>"https://data-api.binance.vision/api/v3/aggTrades?symbol="+s+"&limit=1")]);
  for(const [,opts] of calls){assert.equal(opts.method,"GET");assert.equal(opts.redirect,"error");assert.equal(opts.credentials,"omit");assert.deepEqual(opts.headers,{accept:"application/json"})}
  assert.equal((await market.latestTrade("BTCUSDT&x=1")).code,"UNSUPPORTED_SYMBOL");assert.equal(calls.length,4);
});
test("rate limit stops remaining calls; no hidden retry",async()=>{
  let calls=0,time=at;
  const market=createBinanceRest({now:()=>time,transport:async(url)=>{calls++;return url.pathname.endsWith("/time")?json({serverTime:time}):json({},429,{"retry-after":"10"})}});
  const result=await readMarketSnapshot({market,now:()=>time});assert.equal(result.ok,false);assert.equal(calls,2);assert.ok(result.results.every(r=>r.code==="RATE_LIMITED"));
  assert.equal((await market.latestTrade("BTCUSDT")).retryAfterMs,10000);assert.equal(calls,2);
  time+=10000;await market.latestTrade("BTCUSDT");assert.equal(calls,3);
});
test("ban and malformed network responses never fall back",async()=>{
  let calls=0;const market=createBinanceRest({now:()=>at,transport:async()=>{calls++;return json({},418)}});
  assert.equal((await market.latestTrade("BTCUSDT")).code,"IP_BANNED");assert.equal((await market.latestTrade("BTCUSDT")).code,"IP_BANNED");assert.equal(calls,1);
  for(const [transport,code] of [[async()=>{throw new Error("x")},"NETWORK_ERROR"],[async()=>new Response("not JSON"),"INVALID_RESPONSE"],[async()=>new Response("x".repeat(131073)),"RESPONSE_TOO_LARGE"]]){
    const m=createBinanceRest({now:()=>at,transport});assert.equal((await m.latestTrade("BTCUSDT")).code,code);
  }
});
test("untrusted clock stops before market reads",async()=>{
  let trade=0;const result=await readMarketSnapshot({now:()=>at,market:{serverTime:async()=>({ok:true,data:{serverTime:at+5000},fetchedAt:at}),latestTrade:async()=>{trade++}}});
  assert.equal(result.code,"CLOCK_UNCERTAIN");assert.equal(trade,0);
});
test("snapshot does not publish early observations that expire during the batch",async()=>{
  let clock=at;const market={
    serverTime:async()=>({ok:true,data:{serverTime:at},fetchedAt:at}),
    latestTrade:async symbol=>{
      if(symbol!=="BTCUSDT")clock=at+16000;
      return {ok:true,data:[{...row,T:clock}],fetchedAt:clock};
    }
  };
  const result=await readMarketSnapshot({now:()=>clock,market});
  assert.equal(result.ok,false);assert.equal(result.results[0].code,"STALE_AT_SNAPSHOT");
  assert.ok(result.results[1].ok&&result.results[2].ok);
});
test("backward clock changes abort the snapshot",async()=>{
  const result=await readMarketSnapshot({now:()=>at,market:{serverTime:async()=>({ok:true,data:{serverTime:at},fetchedAt:at}),latestTrade:async()=>({ok:true,data:[row],fetchedAt:at-1})}});
  assert.equal(result.code,"INVALID_CLOCK");
});
