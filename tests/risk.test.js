import assert from "node:assert/strict";
import test from "node:test";
import { RiskEngine, AuditLog, permissionsFor } from "../js/risk.js";
import { MemoryStorage } from "../js/paper.js";

test("risk engine rejects an order above the notional cap", () => {
  const risk = new RiskEngine({ maxOrderNotionalPct: 0.2 });
  const timestamp = new Date("2025-01-06T01:00:00.000Z").getTime(); // Monday 09:00 Taipei
  const decision = risk.approveOrder(
    { equity: 10000, cash: 10000, dailyPnl: 0, positions: [] },
    { market: "US", symbol: "AAPL", side: "buy", qty: 30, price: 100, orderType: "limit", timestamp },
  );
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /上限/);
});

test("risk engine trips the daily loss circuit breaker", () => {
  const risk = new RiskEngine({ maxDailyLossPct: 0.02 });
  const timestamp = new Date("2025-01-06T01:00:00.000Z").getTime(); // Monday 09:00 Taipei
  const decision = risk.approveOrder(
    { equity: 10000, cash: 5000, dailyPnl: -250, positions: [] },
    { market: "US", symbol: "AAPL", side: "buy", qty: 1, price: 100, orderType: "limit", timestamp },
  );
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "DAILY_LOSS_LIMIT");
  assert.equal(risk.isTripped(), true);
});

test("kill switch blocks future orders until explicitly reset", () => {
  const risk = new RiskEngine();
  const timestamp = new Date("2025-01-06T01:00:00.000Z").getTime(); // Monday 09:00 Taipei
  risk.trip("manual test");
  assert.equal(risk.approveOrder({ equity: 10000, cash: 10000, dailyPnl: 0, positions: [] }, { market: "US", symbol: "AAPL", side: "buy", qty: 1, price: 100, orderType: "limit", timestamp }).code, "KILL_SWITCH");
  risk.reset();
  assert.equal(risk.isTripped(), false);
});

test("audit log exports stable CSV without secrets", () => {
  const audit = new AuditLog({ now: () => "2025-01-01T00:00:00.000Z" });
  audit.record("ORDER_ACCEPTED", { symbol: "AAPL", side: "buy", qty: 1 });
  const csv = audit.toCSV();
  assert.match(csv, /version,eventId,timestamp,event,details/);
  assert.match(csv, /ORDER_ACCEPTED/);
  assert.doesNotMatch(csv, /secret|token|api_key/i);
});

test("audit events have a versioned deterministic identity", () => {
  const audit = new AuditLog({
    now: () => "2025-01-01T00:00:00.000Z",
    idGenerator: ({ sequence }) => `audit-${sequence}`,
  });
  const entry = audit.record("ORDER_ACCEPTED", { symbol: "AAPL" });
  assert.equal(entry.version, 1);
  assert.equal(entry.eventId, "audit-1");
  assert.equal(typeof audit.clear, "undefined");
});

test("audit CSV neutralizes spreadsheet formula prefixes", () => {
  const audit = new AuditLog({ now: () => "2025-01-01T00:00:00.000Z" });
  audit.record("=HYPERLINK(\"https://evil.example\")", { text: "=1+1" });
  const csv = audit.toCSV();
  assert.match(csv, /'=HYPERLINK/);
  assert.doesNotMatch(csv, /,=1\+1/);
});

test("audit log reloads versioned events from local persistence", () => {
  const storage = new MemoryStorage();
  const first = new AuditLog({ storage, now: () => "2025-01-01T00:00:00.000Z" });
  first.record("SESSION_OPEN", { mode: "paper" });
  const reloaded = new AuditLog({ storage, now: () => "2025-01-01T00:00:01.000Z" });
  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.list()[0].event, "SESSION_OPEN");
  assert.equal(reloaded.list()[0].version, 1);

  storage.setItem("tw-us-stock-audit-v1", "malformed");
  const recovered = new AuditLog({ storage });
  assert.deepEqual(recovered.list(), []);
});

test("role permissions keep observer read-only", () => {
  assert.equal(permissionsFor("observer").includes("paper:order"), false);
  assert.equal(permissionsFor("trader").includes("paper:order"), true);
  assert.equal(permissionsFor("risk").includes("risk:trip"), true);
});
