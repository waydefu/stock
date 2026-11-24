import {chromium} from "playwright";
import {spawn} from "node:child_process";
import assert from "node:assert/strict";
import {setTimeout as delay} from "node:timers/promises";
import {stageWeb} from "../../scripts/stage-web.js";
const origin="http://127.0.0.1:4175";
stageWeb(process.cwd());
const server=spawn("python3",["-m","http.server","4175","--bind","127.0.0.1","--directory","dist"],{stdio:"ignore"});
let browser;
try{
  let ready=false;
  for(let i=0;i<30;i++){try{if((await fetch("http://127.0.0.1:4175/")).ok){ready=true;break}}catch{}await delay(200)}
  assert.ok(ready,"server unavailable");
  for(const path of ["/archive/stock-v1/package.json","/package.json","/src-tauri/Cargo.toml","/docs/PROJECT_STATUS.md"])assert.equal((await fetch(origin+path)).status,404,path);
  browser=await chromium.launch({headless:true});
  for(const width of [320,390,1440]){
    const page=await browser.newPage({viewport:{width,height:900}});const errors=[],external=[];page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{if(!r.url().startsWith(origin+"/"))external.push(r.url())});
    await page.goto("http://127.0.0.1:4175/");
    await page.waitForFunction(()=>document.querySelectorAll("[data-page]:not([hidden])").length===1);
    assert.equal(await page.locator("#equity").innerText(),"—");assert.ok(await page.locator("#start-paper").isDisabled());
    assert.equal(await page.locator("nav [data-route]").count(),5);
    const go=async route=>{await page.locator('nav [data-route="'+route+'"]').click();await page.waitForFunction(r=>document.querySelector('[data-route="'+r+'"]').getAttribute("aria-current")==="page",route);assert.equal(await page.locator("[data-page]:visible").count(),1);assert.ok(await page.locator("#"+route).isVisible());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator("#mode").innerText(),"PAPER / OFF")};
    for(const r of ["decision","trade","flow","settings","overview"])await go(r);
    await go("settings");await page.locator("#advanced summary").click();await page.locator("#run").click();assert.match(await page.locator("#result").innerText(),/GATE_PASS/);
    for(const [scenario,code] of [["stale","STALE_QUOTE"],["risk","RISK_BUDGET"],["halt","HALTED"]]){await page.locator("#scenario").selectOption(scenario);await page.locator("#run").click();assert.match(await page.locator("#result").innerText(),new RegExp(code))}
    assert.ok(await page.locator("#stop-system").isDisabled());assert.ok(await page.locator("#emergency-stop").isDisabled());
    await go("flow");assert.equal(await page.locator('[data-node][data-state="off"]').count(),8);await page.locator('[data-node="news"]').click();assert.match(await page.locator("#node-reason").innerText(),/未接線/);
    await page.locator("#flow details summary").click();await page.locator("#flow-run").click();assert.equal(await page.locator('[data-node="risk"]').getAttribute("data-state"),"ok");
    for(const [scenario,code] of [["stale","STALE_QUOTE"],["risk","RISK_BUDGET"],["halt","HALTED"]]){await page.locator("#flow-scenario").selectOption(scenario);await page.locator("#flow-run").click();assert.equal(await page.locator('[data-node="risk"]').getAttribute("data-state"),"rejected");assert.equal(await page.locator('[data-node="execution"]').getAttribute("data-state"),"blocked");assert.equal(await page.locator('[data-node="audit"]').getAttribute("data-state"),"blocked");assert.match(await page.locator("#node-reason").innerText(),new RegExp(code))}
    await page.locator("#flow-reset").click();assert.equal(await page.locator('[data-node][data-state="off"]').count(),8);assert.equal(await page.locator('[data-node][aria-pressed="true"]').count(),0);assert.match(await page.locator("#node-description").innerText(),/請選擇/);assert.equal(await page.locator("#mode").innerText(),"PAPER / OFF");
    await page.reload();await page.waitForFunction(()=>document.querySelector('[data-route="flow"]').getAttribute("aria-current")==="page");await go("trade");await page.goBack();await page.waitForFunction(()=>document.querySelector('[data-route="flow"]').getAttribute("aria-current")==="page");assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close()
  }
}finally{await browser?.close();server.kill()}
console.log("five-page browser E2E PASS");
