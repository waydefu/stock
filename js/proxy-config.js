/* Browser-side proxy address (NOT a secret: a public URL is fine).
   Default empty = Fugle mode unavailable (explicit error state, never fake success).
   Deployment substitutes a value by setting
   globalThis.__MARKET_DATA_PROXY_URL__ before app.js loads.
   The Fugle API key itself NEVER belongs here — it lives only in the proxy env. */
export const MARKET_DATA_PROXY_URL = globalThis.__MARKET_DATA_PROXY_URL__ ?? "";
