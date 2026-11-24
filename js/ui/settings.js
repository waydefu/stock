import { $ } from "./dom.js";
import { labels } from "./risk-text.js";

export function mountSettings(evaluate){
  $("run").addEventListener("click",()=>{
    const r=evaluate($("scenario").value);
    $("result").textContent=(labels[r.code]??r.code)+"｜"+r.code+(r.loss===undefined?"":"\n預估模型損失："+(r.loss/1000000).toFixed(4)+" USDT");
  });
}
