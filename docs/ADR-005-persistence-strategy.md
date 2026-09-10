# ADR-005: Persistence Strategy and Multi-Tab Scope

## Status
Accepted (2026-09-10)

## Context
The prototype uses `localStorage` for paper account state and audit log persistence. Current implementation:
- `PaperBroker` reads/writes `tw-us-stock-paper-v1` (schemaVersion 1)
- `AuditLog` reads/writes `tw-us-stock-audit-v1` (versioned events)
- Shallow merge on load, malformed data → safe reset (no silent corruption)
- No migration path for schema version bumps
- Multi-tab behavior undefined (localStorage events not handled)

Risks from register:
- R-005: migration policy missing
- R-006: audit not durable/tamper-proof
- R-017: multi-tab scope not documented

## Decision Drivers
1. **Prototype scope**: paper-only, single-user, local-first
2. **No backend**: no server authority, no database
3. **Safety over convenience**: corrupt/malformed local data must not silently enter trading logic
4. **Honest labeling**: don't claim durability/tamper-proof where none exists

## Options Evaluated

| Option | Security | Tamperability | Persistence | Complexity | Migration |
|--------|----------|---------------|-------------|------------|-----------|
| A: memory-only | High (no local data) | N/A | None | Low | N/A |
| B: localStorage (current) | Low (user-writable) | High (user can edit) | Survives reload | Low | Manual (version check + reset) |
| C: IndexedDB | Low (user-writable) | High | Survives reload | Medium | Manual |
| D: backend append-only | High (server-controlled) | Low (audit trail) | Durable | High | Schema migration via API |

## Decision
**Continue with Option B (localStorage) + explicit policy**:
- Keep `schemaVersion` check on load; unknown version → full reset to safe defaults + emit `PERSISTENCE_RESET` audit event
- Document scope as **single-user, single-tab prototype**; multi-tab sync via `storage` event only for UX hints (e.g., "data updated in another tab"), never for authority
- Audit log remains session-scoped in localStorage; explicitly **not** durable/tamper-proof/server-grade
- No IndexedDB or backend in this phase

## Consequences
### Positive
- Zero new dependencies
- Clear boundary: prototype ≠ production
- Safe reset prevents silent state corruption
- Audit event provides traceability for resets

### Negative
- User can lose data by clearing storage
- Multi-tab edits may conflict (last-write-wins)
- Not suitable for real money or multi-user

## Implementation Requirements
1. **Schema version guard** (already in `PaperBroker.#load()`): unknown `schemaVersion` → `defaultState()` + audit `PERSISTENCE_RESET`
2. **Audit event** for reset: `PERSISTENCE_RESET` with details `{ reason: "schema_version_mismatch", expected: 1, found: X }`
3. **Documentation cleanup**: remove any `tamper-proof`, `append-only audit`, `durable audit` claims from codebase (grep verification)
4. **Multi-tab**: if `storage` event listener added, only show toast/notification; never auto-reload or merge state

## Verification
- Test: unknown schema version triggers safe reset + audit event
- Grep: no misleading durability claims in `docs/`, `README.md`, `index.html`, `js/`

## Related
- R-005, R-006, R-017 in `docs/RISK_REGISTER.md`
- Phase 4 in `docs/FUTURE_PLAN.md`
- `js/paper.js` (PaperBroker.#load), `js/risk.js` (AuditLog)