/* Risk + audit presentation controller.
   Domain decisions stay in RiskEngine/AuditLog; this file only renders state and exports CSV. */
"use strict";

import { escapeHtml } from "./dom.js";
import { statePanel } from "./view.js";

const $ = (selector) => document.querySelector(selector);

export function createRiskAuditController({
  risk,
  audit,
  getRole,
  permissionsFor,
  rolePermissions,
  onAuditExport = () => {},
} = {}) {
  if (!risk || !audit) throw new TypeError("risk 與 audit 為必填");
  if (typeof getRole !== "function" || typeof permissionsFor !== "function") throw new TypeError("role dependencies 必須是函式");
  if (!rolePermissions || typeof rolePermissions !== "object") throw new TypeError("rolePermissions 必須是物件");

  function renderAudit(target = "#audit-log") {
    const element = $(target);
    if (!element) return;
    const entries = audit.list().slice(-40).reverse();
    element.innerHTML = entries.length
      ? entries.map((entry) => `<div><span class="t">${escapeHtml(entry.timestamp)}</span><b>${escapeHtml(entry.event)}</b> <span class="muted">${escapeHtml(JSON.stringify(entry.details))}</span></div>`).join("")
      : statePanel("empty", "尚無事件", "完成研究、風控或紙上操作後，這裡會留下 session audit。");
  }

  function renderRisk(target = "#audit-log") {
    const status = risk.status();
    $("#risk-state").textContent = status.tripped ? "已凍結" : "運作中";
    $("#risk-state").className = `kpi ${status.tripped ? "down" : "up"}`;
    $("#risk-reason").textContent = status.tripped
      ? `${status.reason || "斷路器已啟動"}${status.persisted ? "（已保存，重新整理後仍凍結）" : ""}`
      : "所有紙上訂單仍需先經風控";
    const role = getRole();
    $("#kill-switch").disabled = !permissionsFor(role).includes("risk:trip") || status.tripped;
    $("#reset-risk").disabled = !permissionsFor(role).includes("risk:reset") || !status.tripped;
    $("#permission-table").innerHTML = Object.entries(rolePermissions)
      .map(([name, permissions]) => `<div class="row"><span>${escapeHtml(name)}</span><span class="mono fs-11">${escapeHtml(permissions.join(" · "))}</span></div>`)
      .join("");
    renderAudit(target);
  }

  function downloadAudit() {
    const blob = new Blob([audit.toCSV()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "stock-lab-audit.csv";
    link.click();
    URL.revokeObjectURL(url);
    onAuditExport();
  }

  return Object.freeze({ renderRisk, renderAudit, downloadAudit });
}
