import { $ } from "./dom.js";
import { labels } from "./risk-text.js";

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

const stateLabels={off:"— 未接線",ok:"✓ fixture 通過",rejected:"⊘ fixture 風控拒絕",error:"× 示範異常",blocked:"⊘ 未執行"};
const reasons={NO_EXECUTOR:"僅風控示範，無撮合服務。",POLICY_REJECTED:"風控拒絕，未執行訂單。",RISK_FAILURE:"風控結果異常，禁止執行。",NO_AUDIT_SERVICE:"稽核服務未建立；即使風控拒絕也應保留紀錄。",UNEXPECTED_RESULT:"未預期的風控結果，禁止執行。"};
export function mountFlow({evaluate,snapshot}){
  const buttons=[...document.querySelectorAll("[data-node]")];
  let selected=null,view=snapshot();
  function select(id){
    selected=id;
    for(const b of buttons)b.setAttribute("aria-pressed",String(b.dataset.node===id));
    const [title,description,defaultReason]=definitions[id];
    const reason=view.nodes[id].reason;
    $("node-title").textContent=title;
    $("node-description").textContent=description;
    $("node-reason").textContent=reason==="UNCONNECTED"?defaultReason:reasons[reason]??((labels[reason]??reason)+"｜"+reason);
  }
  function render(){
    for(const b of buttons){const n=view.nodes[b.dataset.node];b.dataset.state=n.state;b.querySelector(".node-state").textContent=stateLabels[n.state]}
    if(selected)select(selected);
  }
  function reset(){
    view=snapshot();selected=null;
    for(const b of buttons)b.setAttribute("aria-pressed","false");
    $("node-title").textContent="節點詳情";$("node-description").textContent="請選擇流程節點。";$("node-reason").textContent="無執行證據。";
    $("flow-mode").textContent="系統架構 · 未接線";
    $("flow-count").textContent="0 / 8 節點已驗證運行";
    $("flow-summary").textContent="目前沒有實際執行紀錄。點選節點可查看職責與阻塞原因。";
    render();
  }
  for(const b of buttons)b.addEventListener("click",()=>select(b.dataset.node));
  $("flow-reset").addEventListener("click",reset);
  $("flow-run").addEventListener("click",()=>{
    const result=evaluate($("flow-scenario").value);
    view=snapshot(result);
    const risk=view.nodes.risk;
    $("flow-mode").textContent="離線故障定位示範 · 非實際流程";
    $("flow-count").textContent=view.fixtureRuns+" / 8 節點執行 fixture；實際運行 "+view.verified;
    const message=risk.state==="ok"?"離線風控通過":risk.state==="rejected"?"離線風控拒絕（正常保護）":"離線示範異常";
    $("flow-summary").textContent=message+"："+risk.reason+"。沒有下單；其餘節點未接線或未執行。";
    render();select("risk");
  });
  reset();
}
