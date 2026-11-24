import { fixture } from "./paper.js";
const button=document.querySelector("#run"), scenario=document.querySelector("#scenario"), result=document.querySelector("#result");
button.addEventListener("click",()=>{const r=fixture(scenario.value);const labels={GATE_PASS:"紙上意圖審核通過（未下單）",STALE_QUOTE:"拒絕：行情過期",RISK_BUDGET:"拒絕：超出預估風險預算",HALTED:"拒絕：系統已停機"};result.textContent=(labels[r.code]??r.code)+"｜"+r.code+(r.loss===undefined?"":"\n預估模型損失："+(r.loss/1000000).toFixed(4)+" USDT");});
