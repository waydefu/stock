import { assess } from "../domain/risk.js";

export function fixture(scenario="normal") {
  const now=100000, intent={action:"OPEN_LONG",symbol:"BTCUSDT",notional:6000000,stopBps:200,createdAt:now,expiresAt:now+30000,evidenceId:"fixture-v1"};
  const context={mode:"PAPER",source:"FIXTURE",halted:false,reconciled:true,now,quoteAt:now,equity:30000000,cash:30000000,positions:0};
  if(scenario==="stale") context.quoteAt=0;
  else if(scenario==="risk") intent.stopBps=900;
  else if(scenario==="halt") context.halted=true;
  else if(scenario!=="normal") return {status:"REJECTED",code:"UNKNOWN_FIXTURE"};
  return assess(intent,context);
}
