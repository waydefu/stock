import { $ } from "./dom.js";

export function mountRouter(){
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
}
