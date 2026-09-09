import { readdirSync, readFileSync } from "node:fs";

// 純程式 UI 品質閘門：只讀原始碼，不開瀏覽器、不連網路。
// 任何 FAIL 代表實作與文件承諾不一致；WARN 代表量測值需人工確認。
// 用法：node scripts/check-ui.js（或 npm run check:ui）

const failures = [];
const warnings = [];
let passes = 0;
const fail = (id, msg) => failures.push(`[FAIL] ${id}: ${msg}`);
const warn = (id, msg) => warnings.push(`[WARN] ${id}: ${msg}`);
const ok = (id) => { passes += 1; };

const html = readFileSync("index.html", "utf8");
const css = readFileSync("css/styles.css", "utf8");
const app = readFileSync("js/app.js", "utf8");
const dom = readFileSync("js/dom.js", "utf8");
const count = (text, re) => (text.match(re) ?? []).length;

// 1. inline style 必須為 0（設計代幣是唯一真相）
{
  const htmlInline = count(html, /style\s*=/g);
  const jsInline = count(app, /style\s*=/g);
  if (htmlInline === 0 && jsInline === 0) ok("no-inline-style");
  else fail("no-inline-style", `index.html 有 ${htmlInline} 處，js/app.js 有 ${jsInline} 處，必須為 0`);
}

// 2. CSS 設計代幣齊全
{
  const root = (css.match(/:root\s*\{[^}]*\}/) ?? [""])[0];
  const required = ["--brand", "--brand-ink", "--brand-deep", "--bg", "--surface", "--ink", "--muted", "--faint",
    "--border", "--up", "--down", "--warn", "--info",
    "--motion-fast", "--motion-base", "--ease-standard", "--radius", "--mono", "--sans"];
  const missing = required.filter((v) => !root.includes(v));
  if (missing.length === 0) ok("css-tokens");
  else fail("css-tokens", `缺少代幣：${missing.join(", ")}`);
}

// 3. 動效代幣真的被使用＋reduced motion
{
  const transitions = count(css, /transition:/g);
  const hasKeyframes = /@keyframes\s+page-enter/.test(css);
  const hasReduced = /prefers-reduced-motion/.test(css);
  if (transitions >= 5 && hasKeyframes && hasReduced) ok("motion-tokens");
  else fail("motion-tokens", `transition=${transitions}（需>=5），keyframes=${hasKeyframes}，reduced-motion=${hasReduced}`);
}

// 4. 對比度：從 CSS 變數即時計算，不寫死比值
{
  const vars = Object.fromEntries([...css.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const lum = (h) => {
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i + 1, i + 3), 16) / 255)
      .map((x) => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const ratio = (a, b) => {
    const s = [lum(a), lum(b)].sort((p, q) => q - p);
    return (s[0] + 0.05) / (s[1] + 0.05);
  };
  const V = (name) => vars[name.replace(/^--/, "")];
  const pairs = [
    ["ink on bg", V("--ink"), V("--bg"), 7, "內文"],
    ["white on brand-deep", "#ffffff", V("--brand-deep"), 4.5, "主按鈕"],
    ["muted on surface", V("--muted"), V("--surface"), 4.5, "次要文字"],
    ["muted on surface-2", V("--muted"), V("--surface-2"), 4.5, "表頭區文字"],
    ["faint on surface", V("--faint"), V("--surface"), 4.5, "輔助文字"],
    ["faint on surface-2", V("--faint"), V("--surface-2"), 4.5, "表格 th"],
    ["up on surface", V("--up"), V("--surface"), 4.5, "上漲語義色"],
    ["down on surface", V("--down"), V("--surface"), 4.5, "下跌語義色"],
    ["warn on surface", V("--warn"), V("--surface"), 4.5, "警告語義色"],
    ["brand on surface", V("--brand"), V("--surface"), 3.0, "logotype／裝飾（WCAG logotype 例外）"],
  ];
  console.log("對比度實測（前景／背景／比值／門檻）：");
  for (const [name, fg, bg, floor, use] of pairs) {
    const r = ratio(fg, bg);
    console.log(`  ${name}: ${fg} on ${bg} = ${r.toFixed(2)}:1（門檻 ${floor}，${use}）`);
    if (r < floor) fail("contrast", `${name} 實測 ${r.toFixed(2)}:1 低於門檻 ${floor}（${use}）`);
  }
  if (!failures.some((f) => f.startsWith("[FAIL] contrast"))) ok("contrast");
}

// 4b. 功能文字用色：badge 與選中態的 color 實測必須達 4.5（只驗 text，不驗線條／logotype）
{
  const problems = [];
  const resolveColor = (block) => {
    const m = block.match(/color\s*:\s*(var\(--([\w-]+)\)|#[0-9a-fA-F]{6})/);
    if (!m) return null;
    if (m[2]) {
      const hex = (css.match(new RegExp(`--${m[2]}\\s*:\\s*(#[0-9a-fA-F]{6})`)) ?? [])[1];
      return hex ?? null;
    }
    return m[1];
  };
  const lum = (h) => {
    const v = [0, 2, 4].map((i) => parseInt(h.slice(i + 1, i + 3), 16) / 255)
      .map((x) => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const ratio = (a, b) => {
    const s = [lum(a), lum(b)].sort((p, q) => q - p);
    return (s[0] + 0.05) / (s[1] + 0.05);
  };
  const vars = Object.fromEntries([...css.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
  const targets = [
    ["badge.brand 文字", /\.badge\.brand\s*\{[^}]*\}/, vars["surface"]],
    ["market-switch 選中文字", /\.market-switch button\[aria-pressed="true"\]\s*\{[^}]*\}/, vars["surface-2"]],
  ];
  for (const [name, re, bg] of targets) {
    const block = (css.match(re) ?? [""])[0];
    if (!block) { problems.push(`找不到規則：${name}`); continue; }
    const fg = resolveColor(block);
    if (!fg) { problems.push(`${name} 解析不出 color`); continue; }
    const r = ratio(fg, bg);
    console.log(`  ${name}: ${fg} on ${bg} = ${r.toFixed(2)}:1（門檻 4.5）`);
    if (r < 4.5) problems.push(`${name} 實測 ${r.toFixed(2)}:1 未達 4.5`);
  }
  if (problems.length === 0) ok("text-contrast-usage");
  else fail("text-contrast-usage", problems.join("；"));
}

// 5. tabs 語義
{
  const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
  const panels = [...html.matchAll(/<section[^>]*role="tabpanel"[^>]*>/g)].map((m) => m[0]);
  const problems = [];
  if (!/role="tablist"/.test(html)) problems.push("缺少 tablist");
  if (tabs.length !== 6) problems.push(`tab 數量=${tabs.length}（需 6）`);
  if (panels.length !== 6) problems.push(`tabpanel 數量=${panels.length}（需 6）`);
  for (const t of tabs) {
    if (!/aria-controls="[^"]+"/.test(t) || !/aria-selected="(true|false)"/.test(t)) problems.push(`tab 缺 aria-controls／aria-selected：${t.slice(0, 60)}…`);
    const id = (t.match(/aria-controls="([^"]+)"/) ?? [])[1];
    if (id && !html.includes(`id="${id}"`)) problems.push(`aria-controls 指向不存在的 id：${id}`);
  }
  const hiddenPanels = panels.filter((p) => /\bhidden\b/.test(p)).length;
  if (hiddenPanels !== 5) problems.push(`初始 hidden panel=${hiddenPanels}（需 5，只留 dashboard 可見）`);
  for (const p of panels) if (!/aria-labelledby="[^"]+"/.test(p)) problems.push("tabpanel 缺 aria-labelledby");
  if (!/ArrowRight/.test(app) || !/tabIndex/.test(app)) problems.push("app.js 缺鍵盤 tab 導覽（ArrowRight／tabIndex）");
  if (problems.length === 0) ok("tab-semantics");
  else fail("tab-semantics", problems.join("；"));
}

// 6. dialog 語義＋鍵盤行為
{
  const problems = [];
  const dialog = (html.match(/<div[^>]*id="order-modal"[^>]*>/) ?? [""])[0];
  for (const attr of ['role="dialog"', 'aria-modal="true"', "aria-labelledby", "aria-describedby", "hidden"]) {
    if (!dialog.includes(attr)) problems.push(`dialog 缺 ${attr}`);
  }
  for (const token of ["Escape", "modal.hidden", ".focus()"]) {
    if (!app.includes(token)) problems.push(`app.js 缺 dialog 行為：${token}`);
  }
  if (problems.length === 0) ok("dialog-semantics");
  else fail("dialog-semantics", problems.join("；"));
}

// 7. 表格語義＋sticky＋橫向捲動容器
{
  const thTotal = count(html, /<th[\s>]/g);
  const thScoped = count(html, /<th[^>]*scope="col"/g);
  const tables = count(html, /<table/g);
  const wrappers = count(html, /overflow-table/g);
  const problems = [];
  if (thTotal === 0) problems.push("找不到 th");
  if (thScoped !== thTotal) problems.push(`th 有 ${thTotal} 個，scope="col" 只有 ${thScoped} 個`);
  if (!/th\s*\{[^}]*position:\s*sticky/.test(css)) problems.push("CSS 缺 sticky th");
  if (wrappers < tables) problems.push(`table 有 ${tables} 個，overflow 容器只有 ${wrappers} 個`);
  if (problems.length === 0) ok("table-semantics");
  else fail("table-semantics", problems.join("；"));
}

// 8. canvas：CSS 高度＋aria-label
{
  const canvases = [...html.matchAll(/<canvas[^>]*>/g)].map((m) => m[0]);
  const problems = [];
  if (!/canvas\.chart\s*\{[^}]*height/.test(css)) problems.push("CSS 缺 canvas.chart 高度");
  if (/canvas\.style\.height/.test(readFileSync("js/charts.js", "utf8"))) problems.push("charts.js 不可用 JS inline 高度覆蓋 CSS");
  if (canvases.length === 0) problems.push("找不到 canvas");
  for (const c of canvases) if (!/aria-label="[^"]+"/.test(c)) problems.push(`canvas 缺 aria-label：${c}`);
  if (problems.length === 0) ok("canvas-baseline");
  else fail("canvas-baseline", problems.join("；"));
}

// 9. 表單控制項可命名＋按鈕可見文字＋文件頭
{
  const problems = [];
  const labelRanges = [...html.matchAll(/<label[\s>][\s\S]*?<\/label>/g)].map((m) => [m.index, m.index + m[0].length]);
  const inLabel = (idx) => labelRanges.some(([s, e]) => idx >= s && idx < e);
  for (const m of html.matchAll(/<(input|select)[^>]*>/g)) {
    const tag = m[0];
    if (!/aria-label="[^"]+"/.test(tag) && !inLabel(m.index)) problems.push(`控制項無可命名方式：${tag.slice(0, 70)}…`);
  }
  for (const m of html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)) {
    const text = m[2].replace(/<[^>]*>/g, "").trim();
    if (!text && !/aria-label="[^"]+"/.test(m[1])) problems.push("按鈕無可見文字也無 aria-label");
  }
  if (!/<html[^>]*lang="zh-Hant"/.test(html)) problems.push("html 缺 lang=zh-Hant");
  if (!/name="viewport"/.test(html)) problems.push("缺 viewport");
  if (!/<title>[^<]+<\/title>/.test(html)) problems.push("title 為空");
  if (!/name="description"/.test(html)) problems.push("缺 description");
  if (!/id="order-submit"[^>]*disabled/.test(html)) problems.push("order-submit 初始應為 disabled");
  if (problems.length === 0) ok("control-naming");
  else fail("control-naming", problems.join("；"));
}

// 9b. 自選按鈕必須是真開關而非裝飾：aria-pressed＋阻斷冒泡＋持久化管線
{
  const problems = [];
  for (const token of ['data-fav="', 'aria-pressed="${active}"', "stopPropagation", "toggleFavorite(storage", "loadFavorites(storage"]) {
    if (!app.includes(token)) problems.push(`缺自選開關要素：${token}`);
  }
  if (problems.length === 0) ok("fav-toggle");
  else fail("fav-toggle", problems.join("；"));
}

// 10. 狀態元件角色（empty／error 可感知；role 是動態計算故驗字串字面；實作住在 view.js）
{
  const problems = [];
  const view = readFileSync("js/view.js", "utf8");
  if (!view.includes('role="${role}"')) problems.push("statePanel 未輸出動態 role");
  if (!view.includes('"alert"') || !view.includes('"status"')) problems.push("statePanel 缺 alert／status 兩種角色字面");
  if (!view.includes("function stateRow(")) problems.push("找不到表格空狀態 stateRow");
  if (!app.includes("stateRow(") && !app.includes("statePanel(")) problems.push("app.js 未使用狀態元件");
  if (problems.length === 0) ok("state-roles");
  else fail("state-roles", problems.join("；"));
}

// 11. escape 覆蓋：只審查真正流向 innerHTML 的模板；
//     純字串 helper（如 symbolLabel）另查所有呼叫點皆被 escape 包住
{
  const rawTokens = ["item.code", "meta.name", "meta.market", "order.symbol", "order.market",
    "order.timestamp", "entry.timestamp", "entry.event", "entry.details", "JSON.stringify(",
    "error.message", "symbolLabel(", "permissions", "STRATEGIES["];
  const problems = [];
  // 找出所有模板字串區間（處理跳脫反引號）
  const spans = [];
  let i = 0;
  while (i < app.length) {
    if (app[i] === "`") {
      const start = i;
      i += 1;
      while (i < app.length) {
        if (app[i] === "\\") { i += 2; continue; }
        if (app[i] === "`") break;
        i += 1;
      }
      spans.push([start, i]);
    }
    i += 1;
  }
  const innerPositions = [...app.matchAll(/innerHTML/g)].map((m) => m.index);
  const isSink = (spanStart) => {
    const prev = innerPositions.filter((p) => p < spanStart).at(-1);
    if (prev === undefined) return false;
    if (spanStart - prev > 900) return false;
    return true;
  };
  // 數值格式化包裝的輸出必為數字字串、favButton 內部已 escape 參數；兩者皆非原始字串裸奔
  const SAFE_NUMERIC = /^\s*(fmtPrice|fmtInt|fmtDay|money|signed|pct|volumeRatio|avgLast|favButton)\s*\(/;
  for (const [s, e] of spans) {
    if (!isSink(s)) continue;
    const body = app.slice(s, e);
    for (const m of body.matchAll(/\$\{([^{}]+)\}/g)) {
      const expr = m[1];
      if (expr.includes("escapeHtml(")) continue;
      if (SAFE_NUMERIC.test(expr)) continue;
      const hit = rawTokens.find((t) => expr.includes(t));
      if (hit) problems.push(`裸插值含 ${hit}：\${${expr.slice(0, 60)}…}`);
    }
  }
  // symbolLabel 回傳純字串：所有呼叫點必須在 escapeHtml( 附近
  for (const m of app.matchAll(/symbolLabel\(/g)) {
    if (app.slice(Math.max(0, m.index - 200), m.index).includes("const symbolLabel")) continue; // 定義本身
    const ctx = app.slice(Math.max(0, m.index - 120), m.index + 80);
    if (!ctx.includes("escapeHtml(")) problems.push(`symbolLabel 呼叫點未被 escape：…${ctx.slice(0, 60)}…`);
  }
  if (!app.includes('from "./dom.js"') || !dom.includes("escapeHtml")) problems.push("escapeHtml 管線不存在");
  if (problems.length === 0) ok("escape-coverage");
  else fail("escape-coverage", problems.join("；"));
}

// 12. 無網路副作用（paper-only 邊界）
{
  const problems = [];
  if (/fetch\s*\(|XMLHttpRequest|new WebSocket/.test(app + readFileSync("js/data.js", "utf8") + readFileSync("js/paper.js", "utf8") + readFileSync("js/charts.js", "utf8"))) {
    problems.push("執行路徑出現網路 API（fetch／XHR／WebSocket）");
  }
  for (const f of readdirSync("js").filter((f) => f.endsWith(".js") && f !== "market-rules.js")) {
    const src = readFileSync(`js/${f}`, "utf8");
    if (/https?:\/\//.test(src)) problems.push(`js/${f} 出現 URL 字串（來源常數只允許在 market-rules.js）`);
  }
  if (problems.length === 0) ok("no-network");
  else fail("no-network", problems.join("；"));
}

// 13. 秘密形狀掃描
{
  const joint = html + css + app + readFileSync("js/paper.js", "utf8") + readFileSync("js/risk.js", "utf8");
  const problems = [];
  if (/api[_-]?key\s*=\s*["'][^"']+["']/i.test(joint)) problems.push("出現 api_key 賦值形狀");
  if (/secret[_-]?key\s*=\s*["']/i.test(joint)) problems.push("出現 secret 賦值形狀");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(joint)) problems.push("出現私鑰形狀");
  if (problems.length === 0) ok("no-secrets");
  else fail("no-secrets", problems.join("；"));
}

// 14. paper-only 標示
{
  const problems = [];
  if (!/PAPER/.test(html + app)) problems.push("找不到 PAPER 標示");
  if (!/紙上|模擬/.test(html)) problems.push("找不到紙上／模擬免責字樣");
  if (problems.length === 0) ok("paper-markers");
  else fail("paper-markers", problems.join("；"));
}

console.log(`\n通過 ${passes} 項，WARN ${warnings.length} 項，FAIL ${failures.length} 項`);
for (const w of warnings) console.log(w);
for (const f of failures) console.log(f);
process.exit(failures.length ? 1 : 0);
