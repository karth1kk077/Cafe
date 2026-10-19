# Progress Ledger

## Current phase: Phase 8 — Production readiness (functional app + tests green)

## Completed
- **Phase 0** — Requirements/architecture, business rules, DB design, risks, defaults (INR, single café).
- **Phase 1** — Monorepo (apps/api, apps/web, packages/shared, prisma, docs, docker);
  TypeScript, Prisma, migrations, seed, health/readiness, config validation, Winston logging,
  centralized error handling, shared Zod schemas.
- **Phase 2** — Staff auth (bcrypt, JWT cookie+Bearer), RBAC middleware, login rate limiting.
- **Phase 3** — Menu + table administration, unpredictable QR tokens, admin API/UI.
- **Phase 4** — Dining-session lifecycle + transactional order creation with idempotency and
  server-side pricing; mobile customer menu, cart, order tracking; **post-closure enforcement**.
- **Phase 5** — Chef phone kitchen UI (live orders, alerts, transitions), waiter dashboard,
  Socket.IO real-time with auth + rooms + reconnect resync.
- **Phase 6** — Billing (immutable snapshots, tax/rounding), payment recording, close/reopen rules.
- **Phase 7** — Unit + integration tests; live smoke suite; fixed defects found.
- **Phase 8** — Spec alignment: **per-order-line-item preparation tracking** + strict
  session-scoped authorization. Line items carry a `QUEUED → PREPARING → READY → SERVED`
  lifecycle (with `CANCELLED`), the order `status` is now a derived summary, every item change
  writes an immutable `OrderItemEvent`, and customers order through a signed session token.
  Kitchen marks each dish ready; waiter collects a per-dish ready queue and marks each served;
  the customer sees per-dish status. See `docs/API.md` and `docs/ARCHITECTURE.md`.

## Files created (high level)
- apps/api: config, lib (logger, prisma, errors, money, asyncHandler, **orderState**,
  **customerSession**), middleware (auth, errorHandler), services (auth, menu, session, order,
  **orderItem**, billing), routes (health, auth, public, staff), socket, app, index;
  vitest config + tests.
- apps/web: Vite React app (customer menu, order tracking, login, kitchen, waiter, admin),
  api/socket/auth libs + **session** helper, Tailwind styles.
- packages/shared: domain types + Zod schemas.
- prisma: schema.prisma, migrations (20261018070541_init, **20261019090000_item_level_status**),
  seed.ts.
- docs: ARCHITECTURE, DB-DESIGN, API, SETUP, SECURITY, TESTING, ACCEPTANCE-TESTS, DEPLOYMENT,
  PROGRESS, smoke.ps1/focus.ps1 + SQL helpers.
- docker: Dockerfile.api, Dockerfile.web, nginx.conf; docker-compose.yml (postgres+api+web).
- Root: package.json (workspaces), tsconfig.base.json, **tsconfig.json** (project references),
  .env.example, .gitignore, README.

## Migrations applied
- `20261018070541_init` (dev `cafe_db` and test `cafe_test_db` both migrated).
- `20261019090000_item_level_status` — adds `OrderItemStatus`, remaps `OrderStatus` to the derived
  summary, adds per-item timestamps/`OrderItemEvent` + indexes, and creates the
  `cafe_order_number_seq` / `cafe_bill_number_seq` sequences. Deployed to both `cafe_db` and
  `cafe_test_db`; `prisma migrate diff` reports no drift.

## Tests executed & results (this environment)
- **Unit + integration (Vitest + Supertest):** 46 passed / 0 failed
  (27 integration, 12 order-state unit, 7 money unit). Command: `npm run test -w @cafe/api`.
  The integration suite covers the item-level lifecycle, derived summary, per-item RBAC and
  invalid-transition rejection, the ready-dish queue, `OrderItemEvent` audit, cancelled-item
  billing, and the critical session-token cases (no token → 401; stale token after close → 409;
  stale token cannot order into a new session at the same table; cross-session read → 404).
  Repeated the suite 17× consecutively with 0 failures to confirm it is not flaky.
- **Live smoke (PowerShell vs running API):** 17 passed / 0 failed
  (server pricing, idempotency, price-tamper, transitions, invalid transition, billing,
  overpayment rejection, **post-closure rejection**, saved-QR `canOrder=false`, RBAC 401/403).
  *Note:* the smoke script was written for the pre-item-level contract; it has not been re-run
  against the item-level API (kept as historical evidence, not re-claimed).
- **Builds:** `tsc -b` (project references across shared/api/web) and `vite build` are **clean**.
  (A prior ledger line claiming clean builds/tests was corrected here: the earlier 25-test count
  predated this change.)

## Environment notes
- Node 24, npm 12, PostgreSQL 18 (local). **Docker is NOT installed** on this machine, so
  `docker compose up` was not executed here; compose + Dockerfiles are provided and documented
  but **unverified in this environment**. Local Postgres was used instead.

## Known issues / limitations
- Docker image build/run unverified (no Docker on host).
- No real payment gateway (cash/staff-recorded only) — by design for v1.
- No CSRF token (auth uses SameSite cookie + Bearer); revisit if `SameSite=none` is enabled.
- Socket horizontal scaling needs the Redis adapter (documented, not wired).
- Playwright E2E not set up (integration + smoke cover the critical flows).

## Definition of Done status
Satisfied and **verified** in this environment:
builds ✓, migrations from clean DB ✓ (both migrations), seed ✓, auth/RBAC ✓, QR resolves table ✓,
customer orders during active session ✓, **server rejects orders after close** ✓,
**stale session token cannot order or read into another/next session** ✓,
**per-item preparation tracked independently** ✓, **derived order summary recomputed** ✓,
**per-item RBAC + invalid-transition rejection** ✓, **immutable per-item event audit** ✓,
duplicate submissions safe (idempotency) ✓, kitchen per-dish ready + waiter per-dish served ✓,
ready-dish pickup queue ✓, bills/payments consistent (cancelled items excluded) ✓,
unpaid-balance + unresolved-orders block close ✓, cross-table/IDOR rejected ✓,
critical automated tests pass ✓, error handling + logging ✓, setup/deploy/backup docs ✓.
Docker deployment and Playwright E2E remain **unverified** (disclosed above), not claimed complete.
The PowerShell smoke suite has not been re-run against the item-level API (see Tests above).

## Next exact step
Re-point `docs/smoke.ps1` at the item-level endpoints and re-run it against a live server, then run
`docker compose up --build` on a Docker-enabled host to verify the containerized stack, and add
Playwright E2E for the four role interfaces if browser-level coverage is required.
