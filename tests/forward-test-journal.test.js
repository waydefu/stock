import test from "node:test";
import assert from "node:assert/strict";
import { MemoryStorage } from "../js/paper.js";
import {
  FORWARD_TEST_JOURNAL_KEY,
  ForwardTestJournal,
  summarizeForwardTestEntries,
} from "../server/forward-test-journal.js";

function account({
  sessionKey,
  equity,
  cash = equity,
  marketValue = 0,
  totalFees = 0,
  realizedPnl = 0,
  unrealizedPnl = 0,
  dailyPnl = 0,
  positions = {},
  orders = [],
} = {}) {
  return {
    sessionKey,
    equity,
    cash,
    marketValue,
    totalFees,
    realizedPnl,
    unrealizedPnl,
    totalPnl: realizedPnl + unrealizedPnl,
    dailyPnl,
    positions,
    orders,
  };
}

test("forward-test journal persists cycle evidence and computes window metrics", () => {
  const storage = new MemoryStorage();
  const journal = new ForwardTestJournal({ storage });

  journal.recordCycle({
    timestamp: "2026-10-27T01:10:00.000Z",
    symbol: "2330",
    code: "NO_TARGET_CHANGE",
    ok: true,
    lifecycle: "PAPER_ENABLED",
    promotionPass: true,
    account: account({ sessionKey: "2026-10-27", equity: 1_000_000, totalFees: 0 }),
  });
  journal.recordCycle({
    timestamp: "2026-10-28T01:10:00.000Z",
    symbol: "2330",
    code: "EXECUTED",
    ok: true,
    lifecycle: "PAPER_ENABLED",
    promotionPass: true,
    account: account({
      sessionKey: "2026-10-28",
      equity: 1_100_000,
      cash: 990_000,
      marketValue: 110_000,
      totalFees: 10,
      positions: { "2330": { symbol: "2330", qty: 1000, avgCost: 100, last: 110, marketValue: 110_000, unrealized: 10_000 } },
      orders: [{ status: "FILLED" }],
    }),
    fills: [{ id: "buy-1", clientOrderId: "c1", side: "buy", qty: 1000, price: 100, fee: 10 }],
  });
  journal.recordCycle({
    timestamp: "2026-10-28T02:10:00.000Z",
    symbol: "2330",
    code: "STALE_QUOTE",
    ok: false,
    lifecycle: "PAPER_ENABLED",
    promotionPass: true,
    account: account({ sessionKey: "2026-10-28", equity: 1_050_000, totalFees: 10 }),
  });
  journal.recordCycle({
    timestamp: "2026-10-29T01:10:00.000Z",
    symbol: "2330",
    code: "EXECUTED",
    ok: true,
    lifecycle: "PAPER_ENABLED",
    promotionPass: true,
    account: account({
      sessionKey: "2026-10-29",
      equity: 900_000,
      totalFees: 30,
      realizedPnl: -100_000,
      orders: [{ status: "FILLED" }, { status: "FILLED" }],
    }),
    fills: [{ id: "sell-1", clientOrderId: "c2", side: "sell", qty: 1000, price: 90, fee: 20 }],
  });

  const summary = journal.summary();
  assert.equal(summary.cycleCount, 4);
  assert.equal(summary.pricedCycleCount, 4);
  assert.equal(summary.sessionDays, 3);
  assert.equal(summary.startEquity, 1_000_000);
  assert.equal(summary.endEquity, 900_000);
  assert.equal(summary.equityChange, -100_000);
  assert.equal(summary.totalReturnPct, -10);
  assert.ok(Math.abs(summary.maxDrawdownPct - 18.1818181818) < 1e-6);
  assert.equal(summary.feesInWindow, 30);
  assert.equal(summary.fillCount, 2);
  assert.equal(summary.buyFills, 1);
  assert.equal(summary.sellFills, 1);
  assert.equal(summary.executedCycles, 2);
  assert.equal(summary.staleQuoteBlocks, 1);

  const reloaded = new ForwardTestJournal({ storage });
  assert.deepEqual(reloaded.summary(), summary);
  assert.equal(reloaded.entries().at(-1).sequence, 4);
});

test("summary tolerates operational cycles without priced account snapshots", () => {
  const summary = summarizeForwardTestEntries([
    { timestamp: "2026-10-27T01:00:00.000Z", code: "PROMOTION_GATE_FAIL", fills: [], account: null },
    { timestamp: "2026-10-27T01:05:00.000Z", code: "DATA_STALE", fills: [], account: null },
  ]);
  assert.equal(summary.cycleCount, 2);
  assert.equal(summary.pricedCycleCount, 0);
  assert.equal(summary.startEquity, null);
  assert.equal(summary.totalReturnPct, null);
  assert.equal(summary.maxDrawdownPct, null);
  assert.equal(summary.promotionGateFails, 1);
});

test("corrupt forward-test journal fails closed", () => {
  const storage = new MemoryStorage();
  storage.setItem(FORWARD_TEST_JOURNAL_KEY, "{broken");
  assert.throws(
    () => new ForwardTestJournal({ storage }),
    (error) => error?.code === "DURABLE_JOURNAL_INVALID",
  );

  storage.setItem(FORWARD_TEST_JOURNAL_KEY, JSON.stringify({ version: 99, nextSequence: 1, entries: [] }));
  assert.throws(
    () => new ForwardTestJournal({ storage }),
    (error) => error?.code === "DURABLE_JOURNAL_INVALID",
  );
});

test("journal capacity fails closed instead of dropping old evidence", () => {
  const storage = new MemoryStorage();
  const journal = new ForwardTestJournal({ storage, maxEntries: 100 });
  for (let i = 0; i < 100; i++) {
    journal.recordCycle({
      timestamp: new Date(Date.parse("2026-10-27T01:00:00.000Z") + i * 60_000).toISOString(),
      symbol: "2330",
      code: "NO_TARGET_CHANGE",
      ok: true,
    });
  }
  assert.throws(
    () => journal.recordCycle({ timestamp: "2026-10-28T01:00:00.000Z", symbol: "2330", code: "NO_TARGET_CHANGE", ok: true }),
    (error) => error?.code === "DURABLE_JOURNAL_FULL",
  );
  assert.equal(journal.entries().length, 100);
});
