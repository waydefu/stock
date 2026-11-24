import { fixture } from "./paper.js";

const $ = id => document.getElementById(id);
const pages = [...document.querySelectorAll("[data-page]")];
const navigation = [...document.querySelectorAll("[data-route]")];
const routes = new Set(pages.map(p => p.id));
function showRoute(focus=false) {
  const requested=location.hash.slice(1);
  const route=routes.has(requested)?requested:"overview";
  for(const p of pages)p.hidden=p.id!==route;
  for(const a of navigation){if(a.dataset.route===route)a.setAttribute("aria-current","page");else a.removeAttribute("aria-current")}
  if(focus){$(route+"-title").focus({preventScroll:true});window.scrollTo(0,0)}
}
showRoute();
window.addEventListener("hashchange",()=>showRoute(true));
const labels={GATE_PASS:"紙上意圖審核通過（未下單）",STALE_QUOTE:"拒絕：行情過期",RISK_BUDGET:"拒絕：超出預估風險預算",HALTED:"拒絕：系統已停機"};
$("run").addEventListener("click",()=>{
  const r=fixture($("scenario").value);
  $("result").textContent=(labels[r.code]??r.code)+"｜"+r.code+(r.loss===undefined?"":"\n預估模型損失："+(r.loss/1000000).toFixed(4)+" USDT");
});
const definitions={
  market:["市場行情","取得並驗證公開價格、交易規則及新鮮度。","行情來源未接線。"],
  news:["時事情報","擷取公告、新聞及宏觀事件，保留來源與時間。","情報來源未接線。"],
  event:["事件觸發","去重並判斷事件是否需要啟動研究。","事件調度未建立。"],
  ai:["AI 決策","形成有證據的交易意圖或 HOLD，不能直接下單。","模型未接線。"],
  quant:["量化驗證","評估證據、成本、策略與資料有效性。","量化服務未接線。"],
  risk:["獨立風控","獨立審核交易意圖，拒絕不合規的操作。","只有離線 fixture，無執行權威。"],
  execution:["紙上執行","模擬撮合、訂單狀態及冪等執行。","模擬撮合服務未建立。"],
  audit:["帳務與稽核","持久帳本、對帳、決策與事件證據。","持久帳本及稽核服務未建立。"]
};
const nodeButtons=[...document.querySelectorAll("[data-node]")];
let selected=null,states={};
function selectNode(id){
  selected=id;
  for(const b of nodeButtons)b.setAttribute("aria-pressed",String(b.dataset.node===id));
  const [title,description,defaultReason]=definitions[id];
  $("node-title").textContent=title;
  $("node-description").textContent=description;
  $("node-reason").textContent=states[id]?.reason??defaultReason;
}
function renderFlow(){
  for(const b of nodeButtons){const s=states[b.dataset.node]??{state:"off",label:"— 未接線"};b.dataset.state=s.state;b.querySelector(".node-state").textContent=s.label}
  if(selected)selectNode(selected);
}
for(const b of nodeButtons)b.addEventListener("click",()=>selectNode(b.dataset.node));
function resetFlow(){
  states={};
  $("flow-mode").textContent="系統架構 · 未接線";
  $("flow-count").textContent="0 / 8 節點已驗證運行";
  $("flow-summary").textContent="目前沒有實際執行紀錄。點選節點可查看職責與阻塞原因。";
  renderFlow();
}
$("flow-reset").addEventListener("click",resetFlow);
$("flow-run").addEventListener("click",()=>{
  const r=fixture($("flow-scenario").value);
  const passed=r.code==="GATE_PASS";
  states={
    risk:{state:passed?"ok":"error",label:passed?"✓ fixture 通過":"× fixture 拒絕",reason:(labels[r.code]??r.code)+"｜"+r.code},
    execution:{state:"blocked",label:"⊘ 未執行",reason:passed?"僅風控示範，無撮合服務。":"風控拒絕 "+r.code+"；未執行訂單。"},
    audit:{state:"blocked",label:"⊘ 未執行",reason:"沒有成交，且持久帳本未建立。"}
  };
  $("flow-mode").textContent="離線故障定位示範 · 非實際流程";
  $("flow-count").textContent="1 / 8 節點執行 fixture；實際運行 0";
  $("flow-summary").textContent=(passed?"離線風控通過":"離線風控拒絕")+"："+r.code+"。沒有下單；其餘節點未接線或未執行。";
  renderFlow();selectNode("risk");
});
resetFlow();
