# Testing

## Strategy
- **Unit** (Vitest): money math, rounding, tax, and the order/item state machine — pure functions,
  no DB.
- **Integration** (Vitest + Supertest): API endpoints against a real PostgreSQL test DB
  (`cafe_test_db`), covering the per-item lifecycle, the derived order summary, session-scoped
  authorization, role-gated transitions, concurrency, idempotency, and the critical stale-QR /
  post-closure attacks.
- **Smoke** (PowerShell + live server): end-to-end verification against the running API.

## Test database
Integration tests use a separate database so they never touch dev data. It is configured in
`apps/api/vitest.config.ts` (`DATABASE_URL` → `cafe_test_db`). Prepare it once:
```bash
createdb cafe_test_db   # or via psql
npx prisma migrate deploy --schema prisma/schema.prisma
# (DATABASE_URL pointed at cafe_test_db)
```

## Running tests
```bash
# Unit + integration (from repo root)
npm run test -w @cafe/api

# Watch mode
npm run test:watch -w @cafe/api
```

## Live smoke suite
Start the API against the dev DB (seeded), then:
```bash
node apps/api/dist/index.js        # from repo root
pwsh docs/smoke.ps1                # or powershell.exe -File docs/smoke.ps1
```
The smoke suite fetches a live table token from the DB and asserts the item-level critical
behaviors (session token, per-dish lifecycle, ready queue, billing, and post-closure rejection).

## Covered scenarios (integration + smoke)
1. Order placed during an active session via a **session-scoped token** (server-priced).
2. Order with **no token** → 401; table with no session → `canOrder=false`, no token.
3. Price tampering ignored (client totals stripped, server recomputes).
4. Idempotent retry returns the same order (no duplicate); key is scoped to the session.
5. **Per-item lifecycle**: each dish moves `QUEUED → PREPARING → READY → SERVED` independently.
6. **Derived summary**: `RECEIVED → IN_PROGRESS → PARTIALLY_READY → READY → COMPLETED`.
7. Role-gated transitions (chef cannot serve; waiter cannot start cooking) and invalid jumps
   (Queued→Served, Served→Preparing) → 403 / 409 `INVALID_TRANSITION`.
8. Cancelling a Queued/Preparing item; re-cancel is rejected; cancelled item → order `CANCELLED`.
9. Ready-dish pickup queue lists ready items for waiters.
10. Immutable per-item `OrderItemEvent` audit trail.
11. Unavailable item rejected.
12. **Post-closure order attempt rejected (stale token / saved QR)** — 409 `SESSION_CLOSED`.
13. **Stale token cannot order into a new session at the same table.**
14. Cross-session order read by another table's token → 404 (IDOR).
15. `canOrder=false` after closure for a saved QR URL.
16. Waiter blocked from admin endpoint (403); unauthenticated staff (401); bad login (401).
17. Two simultaneous distinct submissions both succeed.
18. Same submission retried concurrently creates one row.
19. Concurrent conflicting item transitions serialize: exactly one wins, one gets 409.
20. Only one active session per table (duplicate → 409 `SESSION_EXISTS`).
21. Unresolved order blocks close (409 `UNRESOLVED_ORDERS`); unpaid bill blocks close
    (409 `UNPAID_BALANCE`); pay then close succeeds.
22. Cancelled items excluded from the bill.
23. Overpayment rejected (409).
24. Reopen requires ADMIN (waiter 403) and writes an audit entry.
25. QR token rotation invalidates the old token.

## Results (this environment)
- Unit + integration: **46 passed / 0 failed** (27 integration, 12 order-state unit, 7 money unit).
- The integration suite was run 17× consecutively with 0 failures to confirm it is not flaky.
- Live smoke: the script is updated for the item-level contract; re-run it against a live server to
  refresh the pass count (the previous 17/17 result predated the item-level change).
See docs/PROGRESS.md for the exact run log and environment notes.
