/* Deterministic fake provider: simulates EXTERNAL provider behavior (not markets).
   SimulatedAdapter = synthetic market generator.
   FixtureProviderAdapter = scripted transport failures + corrupt payloads, so the
   adapter boundary proves resilience with zero network, zero accounts, zero secrets.
   Browser-facing configs must pass assertBrowserSafeConfig: secrets belong on a
   trusted server/proxy, never in HTML / JS / storage / Pages. */
"use strict";

import {
  ADAPTER_STATUS,
  DATA_ERROR_CODE,
  DATA_KINDS,
  NORMALIZATION_VERSION,
  MarketDataError,
  assertTransport,
  classifyBars,
  describeCapability,
  evaluateFreshness,
  isRetryableCode,
  mapTransportStatus,
  normalizeBars,
  normalizeQuote,
  wrapEnvelope,
} from "./market-data-contract.js";
import { SimulatedAdapter } from "./market-data.js";

const SECRET_KEY_PATTERN = /api[_-]?key|secret|token|password|passwd|credential|certificate|private[_-]?key/i;

export function assertBrowserSafeConfig(config) {
  for (const [key, value] of Object.entries(config ?? {})) {
    if (SECRET_KEY_PATTERN.test(key) && value !== "" && value !== null && value !== undefined && value !== false) {
      throw new MarketDataError(DATA_ERROR_CODE.DATA_INVALID, `browser-facing adapter config 不得攜帶秘密：${key}`);
    }
  }
}

export function createScriptTransport(steps = []) {
  let cursor = 0;
  return {
    request(op) {
      if (cursor >= steps.length) {
        throw new MarketDataError(DATA_ERROR_CODE.DATA_INVALID, `fixture script 已耗盡（op=${op?.op ?? "unknown"}）：測試劇本與呼叫次數不一致`);
      }
      const step = steps[cursor++];
      if (step && step.fail) throw mapTransportStatus(step.fail);
      if (step && Object.hasOwn(step, "ok")) return step.ok;
      throw new MarketDataError(DATA_ERROR_CODE.DATA_INVALID, "fixture script 步驟必須是 { ok } 或 { fail }");
    },
  };
}

const STATUS_BY_ERROR = Object.freeze({
  [DATA_ERROR_CODE.AUTH_REQUIRED]: ADAPTER_STATUS.AUTH_REQUIRED,
  [DATA_ERROR_CODE.AUTH_FAILED]: ADAPTER_STATUS.AUTH_REQUIRED,
  [DATA_ERROR_CODE.RATE_LIMITED]: ADAPTER_STATUS.RATE_LIMITED,
  [DATA_ERROR_CODE.TIMEOUT]: ADAPTER_STATUS.DEGRADED,
  [DATA_ERROR_CODE.PROVIDER_UNAVAILABLE]: ADAPTER_STATUS.DEGRADED,
  [DATA_ERROR_CODE.DATA_STALE]: ADAPTER_STATUS.STALE,
});

export class FixtureProviderAdapter {
  #transport;
  #clock;
  #provider;
  #markets;
  #capabilities;
  #dataKind;
  #requireAuth;
  #status;

  constructor({ transport, clock = () => Date.now(), provider = "FIXTURE", markets = ["TW"], capabilities = null, dataKind = DATA_KINDS.REALTIME, requireAuth = false, credentials = {} } = {}) {
    this.#transport = assertTransport(transport);
    this.#clock = clock;
    this.#provider = provider;
    this.#markets = [...markets];
    this.#capabilities = capabilities ?? {
      quote: true, historicalBars: true, realtimeStream: true, snapshot: true, corporateActions: false, fundamentals: false,
    };
    this.#dataKind = dataKind;
    this.#requireAuth = requireAuth === true;
    assertBrowserSafeConfig(credentials);
    this.#status = { state: ADAPTER_STATUS.READY, detail: "fixture ready", since: this.#clock() };
  }

  getCapabilities() {
    return describeCapability({
      provider: this.#provider,
      markets: this.#markets,
      capabilities: this.#capabilities,
      dataKinds: [this.#dataKind],
      transport: "injected-fixture",
      auth: this.#requireAuth ? "key-required" : "none",
    });
  }

  getStatus() {
    return { ...this.#status };
  }

  #track(error) {
    const state = STATUS_BY_ERROR[error?.code] ?? ADAPTER_STATUS.DEGRADED;
    this.#status = { state, detail: error?.message ?? "unknown", since: this.#clock() };
  }

  #guardAuth() {
    if (this.#requireAuth) {
      throw new MarketDataError(DATA_ERROR_CODE.AUTH_REQUIRED, "fixture provider 需要認證（劇本未提供憑證）");
    }
  }

  #envelopeFor(data, { market, symbol, providerTimestamp, source, requestId = null }) {
    const receivedAt = this.#clock();
    return wrapEnvelope(data, {
      provider: this.#provider, market, symbol, dataKind: this.#dataKind,
      providerTimestamp, receivedAt, source, requestId, now: receivedAt,
    });
  }

  quote(symbol, { market = null } = {}) {
    try {
      this.#guardAuth();
      if (typeof symbol !== "string" || !symbol) throw new MarketDataError(DATA_ERROR_CODE.INVALID_SYMBOL, "quote 缺 symbol");
      const payload = this.#transport.request({ op: "quote", symbol });
      const normalized = normalizeQuote(payload, { market });
      const envelope = this.#envelopeFor(normalized, {
        market, symbol: normalized.symbol,
        providerTimestamp: normalized.timestamp, source: `${this.#provider}-quote`,
      });
      if (envelope.meta.stale && (this.#dataKind === DATA_KINDS.REALTIME || this.#dataKind === DATA_KINDS.DELAYED)) {
        throw new MarketDataError(DATA_ERROR_CODE.DATA_STALE, `quote 已 stale（age ${envelope.meta.freshnessMs}ms）`, { symbol });
      }
      return envelope;
    } catch (error) {
      this.#track(error);
      throw error;
    }
  }

  getBars(symbol, { market = null } = {}) {
    try {
      this.#guardAuth();
      if (typeof symbol !== "string" || !symbol) throw new MarketDataError(DATA_ERROR_CODE.INVALID_SYMBOL, "bars 缺 symbol");
      const payload = this.#transport.request({ op: "bars", symbol });
      if (!Array.isArray(payload?.bars)) throw new MarketDataError(DATA_ERROR_CODE.DATA_INVALID, "bars payload 缺 bars 陣列");
      const normalized = normalizeBars(payload.bars);
      const envelope = this.#envelopeFor(normalized, {
        market, symbol, providerTimestamp: normalized.length ? normalized[normalized.length - 1].t : null,
        source: `${this.#provider}-bars`,
      });
      return { envelope, issues: classifyBars([...normalized]) };
    } catch (error) {
      this.#track(error);
      throw error;
    }
  }
}

/* Adapter selection is explicit and total: unknown mode throws, never falls back. */
export function selectAdapter(mode, registry = null) {
  const table = registry ?? { simulation: () => new SimulatedAdapter() };
  if (typeof mode !== "string" || typeof table[mode] !== "function") {
    throw new MarketDataError(DATA_ERROR_CODE.UNSUPPORTED_CAPABILITY, `不支援的資料模式：${mode}（不得靜默退回 simulation）`);
  }
  return table[mode]();
}

export { isRetryableCode, NORMALIZATION_VERSION };
