/* Fugle proxy browser adapter: talks ONLY to the trusted proxy, never to Fugle.
   Hard rules: no apiKey option (constructor rejects), no X-API-KEY knowledge,
   no upstream URL knowledge (baseUrl is the proxy origin only).
   Sync legacy quote()/getBars() are intentionally absent: real data is async.
   Sync getCapabilities()/getStatus()/describe() stay available for UI/research. */
"use strict";

import {
  ADAPTER_STATUS,
  DATA_ERROR_CODE,
  DATA_KINDS,
  MarketDataError,
  assertTransport,
  classifyBars,
  describeCapability,
  isLessThanOneCalendarYear,
  isRetryableCode,
  mapTransportStatus,
  normalizeBars,
  normalizeQuote,
  parseRetryAfterMs,
  retryOperation,
} from "./market-data-contract.js";
import { assertBrowserSafeConfig } from "./fixture-provider.js";

const SYMBOL_PATTERN = /^[A-Za-z0-9]{4,6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_TIMEOUT_MS = 10_000;

const STATUS_BY_ERROR = Object.freeze({
  [DATA_ERROR_CODE.AUTH_REQUIRED]: ADAPTER_STATUS.AUTH_REQUIRED,
  [DATA_ERROR_CODE.AUTH_FAILED]: ADAPTER_STATUS.AUTH_REQUIRED,
  [DATA_ERROR_CODE.RATE_LIMITED]: ADAPTER_STATUS.RATE_LIMITED,
  [DATA_ERROR_CODE.TIMEOUT]: ADAPTER_STATUS.DEGRADED,
  [DATA_ERROR_CODE.PROVIDER_UNAVAILABLE]: ADAPTER_STATUS.DEGRADED,
  [DATA_ERROR_CODE.DATA_STALE]: ADAPTER_STATUS.STALE,
});

export class FugleProxyAdapter {
  #baseUrl;
  #fetchImpl;
  #clock;
  #timeoutMs;
  #maxAttempts;
  #sleep;
  #status;

  constructor({ baseUrl = "", fetchImpl = null, clock = () => Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS, maxAttempts = 3, sleep = null, ...extra } = {}) {
    assertBrowserSafeConfig({ baseUrl, ...extra });
    if (typeof baseUrl !== "string") throw new MarketDataError(DATA_ERROR_CODE.DATA_INVALID, "proxy baseUrl 必須是字串");
    this.#baseUrl = baseUrl.replace(/\/+$/, "");
    this.#fetchImpl = fetchImpl ?? globalThis.fetch?.bind(globalThis) ?? null;
    this.#clock = clock;
    this.#timeoutMs = timeoutMs;
    this.#maxAttempts = maxAttempts;
    this.#sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.#status = {
      state: this.#baseUrl ? ADAPTER_STATUS.DISCONNECTED : ADAPTER_STATUS.DISCONNECTED,
      detail: this.#baseUrl ? "尚未成功連線" : "proxy URL 未設定",
      since: this.#clock(),
    };
  }

  getCapabilities() {
    return describeCapability({
      provider: "FUGLE",
      markets: ["TW"],
      capabilities: { quote: true, historicalBars: true, realtimeStream: false, snapshot: false, corporateActions: false, fundamentals: false },
      dataKinds: [DATA_KINDS.REALTIME, DATA_KINDS.HISTORICAL],
      transport: "https-proxy",
      auth: "server-held",
    });
  }

  getStatus() {
    return { ...this.#status };
  }

  describe() {
    return Object.freeze({
      provider: "FUGLE",
      dataKind: null,
      status: this.#status.state,
      pointInTime: "unknown",
      adjustmentMode: "unknown",
      normalizationVersion: 1,
      receivedAt: this.#clock(),
    });
  }

  async quoteAsync(symbol) {
    const clean = assertSymbol(symbol);
    const envelope = await this.#requestJson(`/api/market/quote?symbol=${encodeURIComponent(clean)}`);
    const normalized = normalizeQuote(envelope.data, { market: envelope.data?.market ?? null });
    return { ...envelope, data: normalized };
  }

  async getBarsAsync(symbol, { from, to } = {}) {
    const clean = assertSymbol(symbol);
    const range = assertRange(from, to);
    const envelope = await this.#requestJson(
      `/api/market/bars?symbol=${encodeURIComponent(clean)}&from=${range.from}&to=${range.to}`,
    );
    const normalized = normalizeBars(envelope.data);
    return { envelope: { ...envelope, data: normalized }, issues: classifyBars([...normalized]) };
  }

  #track(error) {
    const state = STATUS_BY_ERROR[error?.code] ?? ADAPTER_STATUS.DEGRADED;
    this.#status = { state, detail: error?.message ?? "unknown", since: this.#clock() };
  }

  async #requestJson(path) {
    if (!this.#baseUrl) throw new MarketDataError(DATA_ERROR_CODE.PROVIDER_UNAVAILABLE, "proxy URL 未設定（Fugle 模式不可用）");
    if (!this.#fetchImpl) throw new MarketDataError(DATA_ERROR_CODE.PROVIDER_UNAVAILABLE, "無可用 fetch transport");
    try {
      const envelope = await retryOperation(
        () => this.#fetchOnce(path),
        { maxAttempts: this.#maxAttempts, sleep: this.#sleep, shouldRetry: (e) => isRetryableCode(e?.code) },
      );
      this.#status = { state: ADAPTER_STATUS.READY, detail: "proxy ok", since: this.#clock() };
      return envelope.value;
    } catch (error) {
      this.#track(error);
      throw error;
    }
  }

  async #fetchOnce(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    timer.unref?.();
    const timeoutRace = new Promise((_, reject) => {
      const t = setTimeout(() => {
        controller.abort();
        const error = new Error("timeout");
        error.name = "TimeoutError";
        reject(error);
      }, this.#timeoutMs);
      t.unref?.();
    });
    try {
      const response = await Promise.race([
        this.#fetchImpl(`${this.#baseUrl}${path}`, {
          method: "GET",
          signal: controller.signal,
        }),
        timeoutRace,
      ]);
      const retryAfterMs = parseRetryAfterMs({ "retry-after": response.headers?.get?.("retry-after") }, this.#clock());
      if (!response.ok) {
        const body = await safeJson(response);
        const code = body?.error?.code;
        if (typeof code === "string" && Object.values(DATA_ERROR_CODE).includes(code)) {
          throw new MarketDataError(code, body.error.message ?? `proxy error ${response.status}`, { requestId: body.error.requestId ?? null, retryAfterMs });
        }
        throw mapTransportStatus({ httpStatus: response.status, retryAfterMs });
      }
      const body = await safeJson(response);
      if (!body || typeof body !== "object" || !body.data || !body.meta || body.meta.provider !== "FUGLE") {
        throw new MarketDataError(DATA_ERROR_CODE.DATA_INVALID, "proxy 回應缺 data／meta 信封");
      }
      return body;
    } catch (error) {
      if (error?.name === "AbortError" || error?.name === "TimeoutError") throw new MarketDataError(DATA_ERROR_CODE.TIMEOUT, `proxy 請求逾時（${this.#timeoutMs}ms）`);
      if (error instanceof MarketDataError) throw error;
      throw new MarketDataError(DATA_ERROR_CODE.PROVIDER_UNAVAILABLE, `proxy 傳輸失敗：${error?.message ?? "unknown"}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

function assertSymbol(symbol) {
  if (typeof symbol !== "string" || !SYMBOL_PATTERN.test(symbol)) {
    throw new MarketDataError(DATA_ERROR_CODE.INVALID_SYMBOL, `symbol 格式不正確：${symbol}`);
  }
  return symbol.toUpperCase();
}

function assertRange(from, to) {
  if (typeof from !== "string" || typeof to !== "string" || !DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
    throw new MarketDataError(DATA_ERROR_CODE.DATA_INVALID, `歷史區間不合法：${from} ~ ${to}`);
  }
  if (!isLessThanOneCalendarYear(from, to)) {
    throw new MarketDataError(DATA_ERROR_CODE.DATA_INVALID, "歷史區間需小於 1 日曆年（恰滿 1 年亦拒絕）");
  }
  return { from, to };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export { assertTransport };
