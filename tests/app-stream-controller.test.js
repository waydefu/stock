import test from "node:test";
import assert from "node:assert/strict";
import { describeStreamText, STREAM_ERROR_ACTION, STREAM_ERROR_TEXT } from "../js/app-stream-controller.js";

test("stream controller keeps actionable terminal error copy", () => {
  assert.match(STREAM_ERROR_TEXT.STREAM_SUBSCRIBE_FAILED, /訂閱失敗/);
  assert.match(STREAM_ERROR_ACTION.STREAM_SUBSCRIBE_FAILED, /代號/);
  const text = describeStreamText({
    symbol: "2330",
    transport: "FAILED",
    upstream: "FAILED",
    eventCount: 0,
    marketStale: true,
    error: { code: "STREAM_SUBSCRIBE_FAILED", terminal: true },
  });
  assert.match(text, /STREAM_SUBSCRIBE_FAILED/);
  assert.match(text, /需手動重試/);
});

test("stream text keeps transport/upstream/freshness separate", () => {
  const text = describeStreamText({
    symbol: "2330",
    transport: "OPEN",
    upstream: "LIVE",
    eventCount: 2,
    marketStale: false,
    error: null,
  });
  assert.match(text, /傳輸 OPEN/);
  assert.match(text, /上游 LIVE/);
  assert.match(text, /新鮮度 FRESH/);
});
