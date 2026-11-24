import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml } from "../js/dom.js";

test("escapeHtml neutralizes markup and attribute delimiters", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert(1)"> & 'quote'`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quote&#39;");
});

test("escapeHtml preserves safe plain text", () => {
  assert.equal(escapeHtml("2330 台積電"), "2330 台積電");
});
