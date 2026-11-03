# Auto Paper 30-Day Deployment & Forward-Test Design

> Status: research/design proposal, 2026-11-03.
> Scope: paper-only. No live broker path, no real-money execution.

## Decision

For the first 30-day unattended forward test, use the **existing Render service upgraded to paid Starter compute with a 1 GB Persistent Disk**, and keep **Proxy + Server Auto Paper Authority in one process / one service instance**.

Target topology:

```text
GitHub Pages (read-only UI / research)
              |
              v
Render paid web service (single instance)
  ├─ trusted Fugle proxy
  ├─ server Auto Paper scheduler
  ├─ Promotion Gate
  ├─ Strategy / Portfolio / Risk
  ├─ Matching Engine
  ├─ PaperBroker
  ├─ Reconciliation
  └─ Forward-Test Journal / report
              |
              v
       Persistent Disk
       /var/data/stock/
```

This is intentionally boring. For a one-month evidence run, reducing moving parts is more valuable than shaving a few dollars or introducing distributed coordination.

## Why Render is the default

Current official Render behavior aligns unusually well with this repo:

- Paid compute does not spin down.
- Starter compute is currently listed at **US$7/month** for 0.5 CPU / 512 MB RAM.
- Persistent Disk is **US$0.25/GB/month**.
- A persistent disk can be attached to only one service instance, and a service with a disk cannot scale to multiple instances.
- During redeploy, Render stops the old disk-attached instance before starting the new one. This sacrifices zero-downtime but reduces simultaneous-writer risk.
- Render sets `RENDER_INSTANCE_ID`, `RENDER_GIT_COMMIT`, service IDs and other runtime metadata useful for audit evidence.

For this workload, 1 GB is already far beyond the expected state/journal footprint. Expected monthly infrastructure cost is therefore about **US$7.25 before any unusual bandwidth overage**.

Official references:
- https://render.com/pricing
- https://render.com/docs/disks
- https://render.com/docs/faq
- https://render.com/docs/environment-variables

## Alternatives

### Railway Hobby

Current official pricing:
- Hobby minimum: **US$5/month**, including the first US$5 of resource usage.
- Volume storage: US$0.15/GB/month.
- Hobby advertises a 99.9% availability target.

Pros:
- Potentially cheaper.
- Volumes are straightforward.
- Good developer experience.

Cons for this repo:
- Requires migration away from the already-working Render runtime.
- Resource billing is usage-based, so the exact month-end amount is less deterministic than a fixed tiny Render instance.
- No meaningful architectural benefit for the first evidence run.

Verdict: **good Plan B**, not worth migrating before the first month.

References:
- https://railway.com/pricing
- https://docs.railway.com/pricing/plans

### Fly.io

Current official pricing examples:
- shared-cpu-1x / 256 MB: about US$2.19/month.
- shared-cpu-2x / 512 MB: about US$4.39/month.
- Volumes: US$0.15/GB/month.

Pros:
- Cheapest reasonable paid always-on option.
- Strong VM-level control.

Cons:
- More deployment/volume operational work.
- 256 MB is unnecessarily tight for Node + market-data runtime.
- Migration adds failure modes exactly when the project should freeze infrastructure.

Verdict: **best cost-optimized paid option later**, not first choice for the evidence month.

Reference:
- https://fly.io/pricing/

### Oracle Cloud Always Free

Official Always Free resources still include eligible compute and up to 200 GB combined boot/block volume allocation. Ampere A1 can provide substantial free compute.

Pros:
- Potentially US$0.
- Plenty of compute and disk for this workload.

Cons:
- Oracle explicitly documents possible “out of host capacity” situations for Always Free shapes.
- Free Tier has no SLA and limited support.
- Requires full VPS operations: OS updates, firewall, process supervision, TLS/reverse proxy or equivalent.

Verdict: **best zero-cash option if capacity is already available and operations are acceptable**, but not the cleanest experimental baseline.

References:
- https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- https://www.oracle.com/tw/cloud/free/faq/

### GitHub Actions cron

Do **not** use GitHub Actions as the trading authority.

GitHub permits scheduled workflows as frequently as every 5 minutes, but GitHub also documents that scheduled jobs can be delayed under high load and queued jobs may be dropped.

That is acceptable for maintenance jobs, not for authoritative order lifecycle / durable forward-test evidence.

References:
- https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- https://docs.github.com/en/actions/how-tos/troubleshoot-workflows

## Deployment configuration

Recommended Render service:

```text
Compute: Starter / 0.5 CPU / 512 MB
Instances: 1
Persistent Disk: 1 GB
Disk mount: /var/data/stock
Health check: /healthz
Auto deploy during test: OFF or pinned/manual
```

Required runtime configuration:

```text
FUGLE_API_KEY=<secret>

AUTO_PAPER_SERVER_ENABLED=1
AUTO_PAPER_DURABLE_STORAGE_CONFIRMED=1
AUTO_PAPER_ALWAYS_ON_CONFIRMED=1
AUTO_PAPER_STATE_FILE=/var/data/stock/auto-paper-state.json
AUTO_PAPER_SYMBOL=2330
AUTO_PAPER_INTERVAL_MS=300000
```

The service must refuse to enable Auto Paper unless all fail-closed confirmations are satisfied.

## Pre-enable blockers

The code is close, but these items should be completed before setting `AUTO_PAPER_SERVER_ENABLED=1`.

### P0 — crash-safe authority lease recovery

Current exclusive `.lock` file correctly prevents concurrent writers, but a hard crash can leave a stale lock file on persistent storage.

A normal graceful shutdown releases it. A SIGKILL / host crash may not.

Required design:

1. Lease metadata records:
   - random lease token
   - `RENDER_INSTANCE_ID`
   - `RENDER_GIT_COMMIT`
   - PID
   - acquired timestamp
   - last heartbeat timestamp
2. Authority updates heartbeat periodically.
3. On startup:
   - missing lock → acquire;
   - live/recent foreign lease → fail closed;
   - stale lease → recover only under an explicitly supported single-instance platform policy.
4. Every recovery event goes to AuditLog and Forward-Test Journal.
5. Never silently delete an unknown fresh lock.

For the Render target, persistent disk already guarantees one service instance, so stale recovery can safely rely on that platform property when `RENDER=1` and the disk configuration is confirmed.

Longer term, SQLite is a cleaner persistence/locking substrate: SQLite serializes writers, provides atomic transactions, and automatically recovers rollback/WAL state after crashes. Do **not** migrate storage immediately before the first month unless testing proves the JSON model inadequate.

SQLite references:
- https://www.sqlite.org/isolation.html
- https://www.sqlite.org/atomiccommit.html
- https://www.sqlite.org/wal.html

### P0 — read-only authority status

Expose a read-only operational surface, with **no mutation endpoint**:

```text
GET /api/auto-paper/status
```

Safe fields:
- enabled
- lifecycle
- symbol
- scheduler state
- last cycle timestamp/code
- last Promotion Gate result
- latest completed bar timestamp
- working order count
- kill-switch state
- journal last-write timestamp
- storage/lease health
- deployed git commit

Never expose:
- API keys
- raw provider credentials
- full filesystem paths if not needed
- any endpoint capable of arming/resetting/trading

### P0 — startup recovery test

Before production enablement, prove this sequence automatically:

```text
start
→ open MATCHING order
→ persist state
→ process restart
→ reacquire authority
→ restore working order
→ fresh quote
→ fill exactly once
→ reconcile
→ journal exactly once
```

Expected invariant: no duplicate fill, no duplicate fee, no lost reservation.

### P1 — immutable forward-test release

The one-month experiment should run a pinned release.

Recommended:
- create tag `forward-test-v1-YYYYMMDD`;
- record exact git SHA in the journal;
- disable automatic server deploys during the measurement month;
- UI/docs may continue separately, but authority code should not drift.

If a correctness bug requires changing authority code:
- stop the test;
- preserve the old evidence;
- increment the experiment version;
- restart the observation window or explicitly segment the report.

## 30-day test protocol

The 30-day run validates **execution correctness and operational reliability first**, not strategy profitability.

A daily 20/60/120 trend strategy on one symbol can naturally produce very few trades in one month. A low trade count is not evidence of alpha failure or success.

### Operational acceptance

Target:
- 0 duplicate ledger mutations.
- 0 unreconciled fills.
- 0 unexplained state resets.
- 0 stale-quote executions.
- 0 out-of-session executions.
- 0 working orders surviving past their DAY expiry.
- 100% fatal storage errors fail closed.
- Restart recovery test passes.
- Expected trading-session cycle coverage ≥ 99%, excluding documented deploy/maintenance windows.

### Evidence completeness

Each cycle should preserve:
- exact git SHA
- symbol
- completed-bar timestamp
- quote provider/freshness
- Promotion Gate result
- signal score/confidence/reason
- target/current exposure
- risk decision
- order status transitions
- fees
- reconciliation result
- equity/PnL
- blocked reason when no execution occurs

### Performance metrics

Keep collecting:
- total return
- max drawdown
- Sharpe
- Sortino
- fees
- turnover
- win rate
- Profit Factor
- expectancy
- average holding time
- Buy & Hold comparison

But do **not** use one month / one symbol as the sole statistical proof that the strategy has edge.

After infrastructure validation, the next research stage should expand evidence either by:
- longer forward duration, or
- a pre-registered multi-symbol universe with the same frozen algorithm.

## Change policy during the test

Allowed without invalidating the experiment:
- dashboard/read-only UI fixes
- documentation
- monitoring that does not alter authority behavior

Requires stopping/segmenting the experiment:
- strategy parameter changes
- allocation changes
- fee-model changes
- matching semantics changes
- risk threshold changes
- market-calendar corrections affecting eligibility
- data-provider normalization changes
- order lifecycle changes

## Recommended implementation order

```text
1. Merge classic layered-backtest cleanup          DONE (#54)
2. Crash-safe lease recovery                       NEXT
3. Read-only Auto Paper status/health endpoint
4. Restart/recovery integration test
5. Render Starter + 1 GB Persistent Disk
6. Pin forward-test release and disable auto deploy
7. 24-hour dry run with AUTO_PAPER_SERVER_ENABLED=1
8. Inspect journal/reconciliation/coverage
9. Start official 30-day forward-test window
10. Generate immutable month-end evidence report
```

## Final recommendation

For **v1**, choose reliability and experimental cleanliness over infrastructure cleverness:

**Render Starter + 1 GB Persistent Disk + one server instance + current atomic state/journal**.

Do not move to Postgres/Redis/Kubernetes/multi-instance architecture for the first month.

The first test should answer:

> “Can this deterministic system observe real market data, make the same mathematical decision reproducibly, pass risk, execute paper orders exactly once, survive restart, reconcile accounting, and preserve trustworthy evidence for a month?”

Only after that should the project optimize infrastructure cost or expand to multiple symbols / live-broker adapters.
