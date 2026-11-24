import assert from "node:assert/strict";
import {readFileSync,readdirSync,mkdtempSync,rmSync,mkdirSync,writeFileSync,symlinkSync} from "node:fs";
import {join,dirname} from "node:path";
import {tmpdir} from "node:os";
import {stageWeb,WEB_ASSETS} from "./stage-web.js";
const root=mkdtempSync(join(tmpdir(),"crypto-lab-stage-"));
try{
  for(const p of [...WEB_ASSETS,"archive/stock-v1/private-fixture.txt","unlisted.txt"]){
    const f=join(root,p);mkdirSync(dirname(f),{recursive:true});writeFileSync(f,p);
  }
  const out=stageWeb(root);
  assert.deepEqual(readdirSync(out,{recursive:true}).map(p=>String(p).replaceAll("\\","/")).filter(p=>WEB_ASSETS.includes(p)).sort(),[...WEB_ASSETS].sort());
  assert.deepEqual(readdirSync(out).sort(),["css","index.html","js"]);
  assert.deepEqual(readdirSync(join(out,"css")),["styles.css"]);
  assert.deepEqual(readdirSync(join(out,"js")).sort(),["app.js","paper.js"]);
  for(const p of WEB_ASSETS)assert.equal(readFileSync(join(out,p),"utf8"),p);
  if(process.platform!=="win32"){
    const css=join(root,"css");rmSync(css,{recursive:true});mkdirSync(join(root,"outside"));
    writeFileSync(join(root,"outside","styles.css"),"untrusted");symlinkSync(join(root,"outside"),css,"dir");
    assert.throws(()=>stageWeb(root),/Invalid web asset/);
  }
  const config=JSON.parse(readFileSync("src-tauri/tauri.conf.json","utf8"));
  const pkg=JSON.parse(readFileSync("package.json","utf8"));
  assert.equal(config.version,pkg.version);
  assert.equal(config.build.frontendDist,"../dist");
  assert.equal(config.app.withGlobalTauri,false);
  assert.deepEqual(config.app.security.capabilities,[]);
  assert.match(config.app.security.csp,/connect-src 'none'/);
  assert.doesNotMatch(readFileSync("src-tauri/src/lib.rs","utf8"),/\.plugin\(|\.invoke_handler\(/);
  const activity=readFileSync("src-tauri/android-overlay/MainActivity.kt","utf8");
  for(const token of ["BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE","controller.hide(WindowInsetsCompat.Type.systemBars())","getInsetsIgnoringVisibility","Type.displayCutout()","Type.mandatorySystemGestures()","onWindowFocusChanged"])assert.ok(activity.includes(token),token);
  assert.match(pkg.scripts["native:android:init"],/apply-android-overlay/);
  assert.match(pkg.scripts["native:android"],/apply-android-overlay/);
  assert.doesNotMatch(activity,/addJavascriptInterface|FLAG_KEEP_SCREEN_ON|FLAG_SHOW_WHEN_LOCKED/);
  console.log("Packaging isolation PASS");
}finally{rmSync(root,{recursive:true,force:true})}
