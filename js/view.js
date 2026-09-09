/* 純顯示 helper：無 DOM、無狀態，輸出字串；XSS 關鍵路徑（statePanel／symbolLabel 呼叫點）由單測鎖住。 */
"use strict";

import { getSymbol } from "./data.js";
import { escapeHtml } from "./dom.js";

export const money = (value, currency) => `${currency} ${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const signed = (value, digits = 2) => `${value >= 0 ? "+" : ""}${Number(value).toFixed(digits)}`;
export const pct = (value) => `${signed(value)}%`;
export const tone = (value) => value > 0 ? "up" : value < 0 ? "down" : "neutral";
export const symbolLabel = (code) => { const item = getSymbol(code); return item ? `${item.code} ${item.name}` : code; };
export const fmtDay = (t) => new Date(t).toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit" });
export const avgLast = (values, length) => values.slice(-length).reduce((a, b) => a + b, 0) / Math.min(length, values.length);

export function statePanel(kind, title, detail) {
  const safeKind = ["empty", "error", "loading", "permission", "success"].includes(kind) ? kind : "empty";
  const role = safeKind === "error" ? "alert" : "status";
  return `<div class="state-block state-${safeKind}" role="${role}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`;
}

export function stateRow(colspan, kind, title, detail) {
  return `<tr><td colspan="${colspan}">${statePanel(kind, title, detail)}</td></tr>`;
}
