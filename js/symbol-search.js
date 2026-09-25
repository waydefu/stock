/* Global symbol search resolver (pure, no DOM).
   Local hit (case-insensitive code or name) -> open the built-in chart.
   Local miss + code-shaped query -> validate via Fugle, even in simulation
   mode. That lookup does not change PAPER mode and does not add an orderable
   symbol. Remote hits live in state.runtimeSymbol only. */
"use strict";

export const SEARCH_ACTIONS = Object.freeze({
  NOOP: "noop",
  OPEN_LOCAL: "open-local",
  VALIDATE_REMOTE: "validate-remote",
  NEEDS_FUGLE_MODE: "needs-fugle-mode",
  NOT_FOUND: "not-found",
});

/* TW remote-candidate shape: 4-digit (or 4-6 alnum) codes Fugle can resolve.
   Anything else (e.g. free text with no local hit) is NOT_FOUND, not remote. */
const REMOTE_CODE_PATTERN = /^[A-Za-z0-9]{4,6}$/;

export function normalizeSearchQuery(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

/* Exact code, then code prefix, then name. Both sides are case-folded. */
export function findLocalSymbol(raw, symbols) {
  const query = normalizeSearchQuery(raw).toLowerCase();
  if (!query || !Array.isArray(symbols)) return null;
  const exact = symbols.find((item) => String(item.code).toLowerCase() === query);
  if (exact) return exact.code;
  const prefix = symbols.find((item) => String(item.code).toLowerCase().startsWith(query));
  if (prefix) return prefix.code;
  const named = symbols.find((item) => String(item.name).toLowerCase().includes(query));
  return named ? named.code : null;
}

/* localFind(query, raw): exact code -> prefix code -> local name; preserves the
   historical priority. Returns a code string or null. Injected for tests. */
export function resolveSearchQuery(raw, { localFind, symbols } = {}) {
  const query = normalizeSearchQuery(raw);
  if (!query) return { action: SEARCH_ACTIONS.NOOP };
  const code = typeof localFind === "function"
    ? localFind(query.toLowerCase(), query)
    : findLocalSymbol(query, symbols);
  if (code) return { action: SEARCH_ACTIONS.OPEN_LOCAL, code };
  if (!REMOTE_CODE_PATTERN.test(query)) return { action: SEARCH_ACTIONS.NOT_FOUND, query };
  return { action: SEARCH_ACTIONS.VALIDATE_REMOTE, code: query.toUpperCase() };
}

/* Remote validation via an injected quote function (adapter.quoteAsync in app).
   Never throws: every failure becomes an explicit {ok:false} with the stable
   upstream code (INVALID_SYMBOL / TIMEOUT / ...), so the UI can never go
   silent and never falls back to simulation. */
export async function validateRemoteSymbol(code, { quoteFn }) {
  if (typeof quoteFn !== "function") return { ok: false, code: "PROXY_NOT_CONFIGURED", message: "缺少遠端查詢函式" };
  try {
    const envelope = await quoteFn(code);
    const symbol = envelope?.data?.symbol ?? code;
    if (envelope?.meta?.provider && envelope.meta.provider !== "FUGLE") {
      return { ok: false, code: "DATA_INVALID", message: "provenance 非 FUGLE，拒絕混用" };
    }
    return { ok: true, symbol, envelope };
  } catch (error) {
    const upstream = typeof error?.code === "string" ? error.code : "PROVIDER_UNAVAILABLE";
    return { ok: false, code: upstream, message: error?.message ?? upstream };
  }
}

export function describeSearchAction(decision) {
  switch (decision?.action) {
    case SEARCH_ACTIONS.OPEN_LOCAL:
      return { kind: "local", text: "" };
    case SEARCH_ACTIONS.NEEDS_FUGLE_MODE:
      return { kind: "info", text: `「${decision.code}」需要遠端查詢。查到只進看盤，不加入下單清單，也不切換 PAPER。` };
    case SEARCH_ACTIONS.VALIDATE_REMOTE:
      return { kind: "loading", text: `向 Fugle 驗證「${decision.code}」…` };
    case SEARCH_ACTIONS.NOT_FOUND:
      return { kind: "error", text: `查無標的「${decision.query}」：非內建代號／名稱，也非有效代號格式。` };
    default:
      return { kind: "none", text: "" };
  }
}
