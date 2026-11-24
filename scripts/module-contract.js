// Explicit module inventory and direct import allowlist; review changes as architecture changes.
export const MODULE_EDGES=Object.freeze({
  "js/app.js":["js/application/fixture.js","js/application/flow.js","js/ui/router.js","js/ui/settings.js","js/ui/flow.js"],
  "js/domain/risk.js":[],
  "js/application/fixture.js":["js/domain/risk.js"],
  "js/application/flow.js":[],
  "js/ui/dom.js":[],
  "js/ui/router.js":["js/ui/dom.js"],
  "js/ui/risk-text.js":[],
  "js/ui/settings.js":["js/ui/dom.js","js/ui/risk-text.js"],
  "js/ui/flow.js":["js/ui/dom.js","js/ui/risk-text.js"]
});
export const MODULES=Object.freeze(Object.keys(MODULE_EDGES));
