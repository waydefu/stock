import assert from "node:assert/strict";
import test from "node:test";
import { RiskEngine, AuditLog, permissionsFor } from "../js/risk.js";

test("risk engine rejects an order above the notional cap", () => {
  const risk = new RiskEngine({ maxOrderNotionalPct: 0.2 });
  const decision = risk.approveOrder(
    { equity: 10000, cash: 10000, dailyPnl: 0, positions: [] },
    { symbol: "2330", side: "buy", qty: 30, price: 100 },
  );
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /上限/);
});

test("risk engine trips the daily loss circuit breaker", () => {
  const risk = new RiskEngine({ maxDailyLossPct: 0.02 });
  const decision = risk.approveOrder(
    { equity: 10000, cash: 5000, dailyPnl: -250, positions: [] },
    { symbol: "2330", side: "buy", qty: 1, price: 100 },
  );
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "DAILY_LOSS_LIMIT");
  assert.equal(risk.isTripped(), true);
});

test("kill switch blocks future orders until explicitly reset", () => {
  const risk = new RiskEngine();
  risk.trip("manual test");
  assert.equal(risk.approveOrder({ equity: 10000, cash: 10000, dailyPnl: 0, positions: [] }, { symbol: "AAPL", side: "buy", qty: 1, price: 100 }).code, "KILL_SWITCH");
  risk.reset();
  assert.equal(risk.isTripped(), false);
});

test("audit log exports stable CSV without secrets", () => {
  const audit = new AuditLog({ now: () => "2025-01-01T00:00:00.000Z" });
  audit.record("ORDER_ACCEPTED", { symbol: "AAPL", side: "buy", qty: 1 });
  const csv = audit.toCSV();
  assert.match(csv, /timestamp,event,details/);
  assert.match(csv, /ORDER_ACCEPTED/);
  assert.doesNotMatch(csv, /secret|token|api_key/i);
});

test("audit CSV neutralizes spreadsheet formula prefixes", () => {
  const audit = new AuditLog({ now: () => "2025-01-01T00:00:00.000Z" });
  audit.record("=HYPERLINK(\"https://evil.example\")", { text: "=1+1" });
  const csv = audit.toCSV();
  assert.match(csv, /'=HYPERLINK/);
  assert.doesNotMatch(csv, /,=1\+1/);
});

test("role permissions keep observer read-only", () => {
  assert.equal(permissionsFor("observer").includes("paper:order"), false);
  assert.equal(permissionsFor("trader").includes("paper:order"), true);
  assert.equal(permissionsFor("risk").includes("risk:trip"), true);
});
