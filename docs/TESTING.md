# Testing

## Strategy
- **Unit** (Vitest): money math, rounding, tax — pure functions, no DB.
- **Integration** (Vitest + Supertest): API endpoints against a real PostgreSQL test DB
  (`cafe_test_db`), covering the full order/session/billing lifecycle, authorization,
  concurrency, idempotency, and the critical post-closure ordering attack.
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
The smoke suite fetches a live table token from the DB and asserts 17 critical behaviors.

## Covered scenarios (integration + smoke)
1. Order placed during an active session (server-priced).
2. Price tampering ignored (client totals stripped, server recomputes).
3. Idempotent retry returns the same order (no duplicate).
4. Order status transitions enforced; invalid jump → 409.
5. Unavailable item rejected.
6. **Post-closure order attempt rejected (stale tab / saved QR)** — 409 `SESSION_CLOSED`.
7. `canOrder=false` after closure for a saved QR URL.
8. No active session → order rejected.
9. Waiter blocked from admin endpoint (403); unauthenticated staff (401); bad login (401).
10. Two simultaneous distinct submissions both succeed.
11. Same submission retried concurrently creates one row.
12. Only one active session per table (duplicate → 409).
13. Unpaid bill blocks close (409 `UNPAID_BALANCE`); pay then close succeeds.
14. Overpayment rejected (409).
15. Unresolved order blocks close (409 `UNRESOLVED_ORDERS`).
16. Reopen requires ADMIN (waiter 403) and writes an audit entry.
17. Cross-table ordering bound to the correct table (IDOR).

## Results (this environment)
- Unit + integration: **25 passed / 0 failed** (18 integration, 7 unit).
- Live smoke: **17 passed / 0 failed**.
See docs/PROGRESS.md for the exact run log and environment notes.
