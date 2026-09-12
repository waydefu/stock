/* Browser-facing SSE transport (Phase 7C PR2b, server-only).
   Serializes provider-neutral stream envelopes only — raw Fugle frames never
   reach here (see server/fugle-stream-manager.js). Three disjoint livenesses:
   SSE comment keepalive (this file) ≠ upstream heartbeat (manager) ≠ market
   freshness (envelope meta). Backpressure policy: a client whose socket
   buffer is full is disconnected (latest-state oriented; one slow client must
   not stall fan-out). */
"use strict";

export const SSE_HEADERS = Object.freeze({
  "content-type": "text/event-stream",
  "cache-control": "no-cache",
  connection: "keep-alive",
  "x-accel-buffering": "no",
});
/* Browser reconnect hint (PR3 UI uses native EventSource auto-reconnect):
   a dropped SSE stream retries after 5s instead of the ~3s default. Sent as
   the preamble right after headers, before any event. */
export const SSE_RETRY_MS = 5000;

export function formatRetryHint() {
  return `retry: ${SSE_RETRY_MS}\n\n`;
}

export const SSE_KEEPALIVE_COMMENT = ": keepalive";
export const DEFAULT_SSE_KEEPALIVE_MS = 20_000;

export function formatSseEvent(event, data) {
  const name = typeof event === "string" && event ? event : "message";
  return `event: ${name}\ndata: ${JSON.stringify(data ?? null)}\n\n`;
}

export function formatKeepalive() {
  return `${SSE_KEEPALIVE_COMMENT}\n\n`;
}

export function statePayload({ state, key = null, sessionId = null, at = null }) {
  return { state, key, sessionId, at };
}

export function tradePayload(envelope, sequenceStatus = "ok") {
  return {
    provider: envelope.meta.provider,
    market: envelope.meta.market,
    symbol: envelope.meta.symbol,
    channel: envelope.meta.channel,
    dataKind: envelope.meta.dataKind,
    source: envelope.meta.source,
    providerTimestamp: envelope.meta.providerTimestamp,
    receivedAt: envelope.meta.receivedAt,
    freshnessMs: envelope.meta.freshnessMs,
    stale: envelope.meta.stale,
    freshnessStatus: envelope.meta.freshnessStatus,
    sequence: envelope.meta.sequence,
    sequenceStatus,
    isTrial: envelope.meta.isTrial,
    normalizationVersion: envelope.meta.normalizationVersion,
    sessionId: envelope.meta.sessionId,
    trade: envelope.data,
  };
}

export function errorPayload({ code, message, key = null, sessionId = null }) {
  return { code, message, key, sessionId };
}

/* Sink over a Node http.ServerResponse. write() false (kernel buffer full)
   => caller must detach + close the client (slow-client policy). */
export function createSseSink(res, { sessionId = null, onGone = null } = {}) {
  let closed = false;
  const sink = {
    get closed() { return closed; },
    writeRaw(chunk) {
      if (closed) return false;
      try {
        return res.write(chunk) !== false;
      } catch {
        return false;
      }
    },
    sendState(state, key = null) {
      return sink.writeRaw(formatSseEvent("state", statePayload({ state, key, sessionId, at: Date.now() })));
    },
    sendTrade(envelope, sequenceStatus = "ok") {
      return sink.writeRaw(formatSseEvent("trade", tradePayload(envelope, sequenceStatus)));
    },
    sendError(code, message, key = null) {
      if (closed) return false;
      const ok = sink.writeRaw(formatSseEvent("error", errorPayload({ code, message, key, sessionId })));
      sink.close();
      return ok;
    },
    keepalive() {
      return sink.writeRaw(formatKeepalive());
    },
    close() {
      if (closed) return;
      closed = true;
      try { res.end(); } catch { /* client gone */ }
      try { onGone?.(); } catch { /* detach must not throw */ }
    },
  };
  try {
    res.on("close", () => sink.close());
  } catch { /* fake responses in tests may lack .on */ }
  return sink;
}
