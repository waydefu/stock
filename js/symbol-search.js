/* Global symbol search resolver (pure, no DOM).
   Top search must resolve ANY TW code, not just built-in demo SYMBOLS:
   local hit -> open chart; local miss + fugle-proxy mode -> validate the code
   against the trusted proxy (quote); local miss + simulation -> explicit
   message, never a silent no-op and never a secret outbound call.
   Remote-validated symbols live in state.runtimeSymbol and NEVER merge back
   into simulation SYMBOLS or the PAPER order ticket (search is行情查詢, not
   order authorization). */
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

/* localFind(query, raw): exact code -> prefix code -> local name; preserves the
   historical priority. Returns a code string or null. Injected for tests. */
export function resolveSearchQuery(raw, { localFind, dataMode = "simulation" } = {}) {
  const query = normalizeSearchQuery(raw);
  if (!query) return { action: SEARCH_ACTIONS.NOOP };
  const code = typeof localFind === "function" ? localFind(query, raw) : null;
  if (code) return { action: SEARCH_ACTIONS.OPEN_LOCAL, code };
  if (!REMOTE_CODE_PATTERN.test(query)) return { action: SEARCH_ACTIONS.NOT_FOUND, query };
  if (dataMode === "fugle-proxy") return { action: SEARCH_ACTIONS.VALIDATE_REMOTE, code: query.toUpperCase() };
  return { action: SEARCH_ACTIONS.NEEDS_FUGLE_MODE, code: query.toUpperCase() };
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
      return { kind: "info", text: `「${decision.code}」不在內建模擬清單；切換「Fugle 真實行情」後可查詢（不會自動切換）。` };
    case SEARCH_ACTIONS.VALIDATE_REMOTE:
      return { kind: "loading", text: `向 Fugle 驗證「${decision.code}」…` };
    case SEARCH_ACTIONS.NOT_FOUND:
      return { kind: "error", text: `查無標的「${decision.query}」：非內建代號／名稱，也非有效代號格式。` };
    default:
      return { kind: "none", text: "" };
  }
}
