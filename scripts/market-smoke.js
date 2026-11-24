import {createBinanceRest} from "../server/market/binance-rest.js";
import {readMarketSnapshot} from "../server/market/application.js";
const now=()=>Date.now();
const market=createBinanceRest({transport:globalThis.fetch,now});
const result=await readMarketSnapshot({market,now});
console.log(JSON.stringify(result,null,2));
if(!result.ok)process.exitCode=1;
