import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { SYMBOLS, getSymbol } from "../js/data.js";
import { SEARCH_ACTIONS, describeSearchAction, findLocalSymbol, resolveSearchQuery, validateRemoteSymbol } from "../js/symbol-search.js";
import { fugleResearchRange } from "../js/research-range.js";

// Execute the actual app orchestration, including its mode guard, rather than
// only testing the pure resolver which missed the regression in PR #34.
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
function appFunction(name) {
  const start = app.search(new RegExp(`(?:async )?function ${name}\\(`));
  if (start < 0) return "";
  const rest = app.slice(start);
  const end = rest.slice(1).search(/\n(?:async )?function /);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

function harness({ symbol = "0050", baseUrl = "https://proxy.example", error = null } = {}) {
  const calls = [];
  const elements = {
    "#symbol-search": { value: symbol },
    "#symbol-search-btn": { disabled: false },
  };
  const state = { dataMode: "simulation", runtimeSymbol: null, runtimeChart: null };
  const notices = [];
  const context = vm.createContext({
    state, searchPending: false, MARKET_DATA_PROXY_URL: baseUrl,
    SYMBOLS, getSymbol, SEARCH_ACTIONS, describeSearchAction, findLocalSymbol,
    resolveSearchQuery, validateRemoteSymbol, fugleResearchRange,
    FUGLE_ERROR_TEXT: { TIMEOUT: "請求逾時" },
    $: (selector) => elements[selector],
    showSearchNotice: (kind, text) => notices.push({ kind, text }),
    auditEvent() {}, rememberSearch() {}, renderChart() {},
    setPage: (page) => { state.page = page; },
    openSymbol: (code) => { state.symbol = code; },
    FugleProxyAdapter: class {
      constructor({ baseUrl }) { calls.push(["adapter", baseUrl]); }
      async quoteAsync(code) {
        calls.push(["quote", code]);
        if (error) throw Object.assign(new Error(error), { code: error });
        return { data: { symbol: code, price: 100, previousClose: 99 }, meta: { provider: "FUGLE" } };
      }
      async getBarsAsync(code) {
        calls.push(["bars", code]);
        return { envelope: { data: [{ t: 1, o: 99, h: 101, l: 98, c: 100, v: 20 }] } };
      }
    },
  });
  const names = ["createFugleAdapter", "requireFugleAdapter", "taipeiYMD", "openRemoteChart", "runSymbolSearch"];
  vm.runInContext(names.map(appFunction).join("\n"), context);
  return { context, state, calls, notices, elements };
}

test("global search opens remote quote and bars from the default simulation mode", async () => {
  for (const symbol of ["0050", "006208"]) {
    const h = harness({ symbol });
    await vm.runInContext("runSymbolSearch()", h.context);
    assert.ok(h.calls.some(([type, code]) => type === "quote" && code === symbol), h.notices.at(-1)?.text);
    assert.ok(h.calls.some(([type, code]) => type === "bars" && code === symbol));
    assert.equal(h.state.runtimeChart.code, symbol);
    assert.equal(h.state.runtimeChart.bars.length, 1);
    assert.equal(h.state.page, "chart");
    assert.equal(h.state.dataMode, "simulation");
    assert.equal(h.elements["#symbol-search-btn"].disabled, false);
    assert.ok(!SYMBOLS.some((item) => item.code === symbol));
  }
});

test("built-in search works locally without proxy configuration", async () => {
  const h = harness({ symbol: "aapl", baseUrl: "" });
  await vm.runInContext("runSymbolSearch()", h.context);
  assert.equal(h.state.symbol, "AAPL");
  assert.equal(h.calls.length, 0);
});

test("missing proxy configuration remains explicit and makes no request", async () => {
  const h = harness({ baseUrl: "" });
  await vm.runInContext("runSymbolSearch()", h.context);
  assert.match(h.notices.at(-1).text, /PROXY_NOT_CONFIGURED/);
  assert.equal(h.state.runtimeChart, null);
  assert.equal(h.calls.length, 0);
  assert.equal(h.elements["#symbol-search-btn"].disabled, false);
});

test("failed remote search displays the provider error and releases the button", async () => {
  const h = harness({ error: "TIMEOUT" });
  await vm.runInContext("runSymbolSearch()", h.context);
  assert.match(h.notices.at(-1).text, /TIMEOUT/);
  assert.equal(h.state.runtimeChart, null);
  assert.equal(h.elements["#symbol-search-btn"].disabled, false);
});

test("explicit Fugle quote and research actions still require the selected mode", () => {
  const h = harness();
  assert.throws(() => vm.runInContext("requireFugleAdapter()", h.context), (error) => error.code === "FUGLE_MODE_OFF");
  assert.equal(h.calls.length, 0);
});
