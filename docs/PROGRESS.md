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

## Files created (high level)
- apps/api: config, lib (logger, prisma, errors, money, asyncHandler), middleware (auth,
  errorHandler), services (auth, menu, session, order, billing), routes (health, auth, public,
  staff), socket, app, index; vitest config + tests.
- apps/web: Vite React app (customer menu, order tracking, login, kitchen, waiter, admin),
  api/socket/auth libs, Tailwind styles.
- packages/shared: domain types + Zod schemas.
- prisma: schema.prisma, migrations (20261018070541_init), seed.ts.
- docs: ARCHITECTURE, DB-DESIGN, API, SETUP, SECURITY, TESTING, ACCEPTANCE-TESTS, DEPLOYMENT,
  PROGRESS, smoke.ps1/focus.ps1 + SQL helpers.
- docker: Dockerfile.api, Dockerfile.web, nginx.conf; docker-compose.yml (postgres+api+web).
- Root: package.json (workspaces), tsconfig.base.json, .env.example, .gitignore, README.

## Migrations applied
- `20261018070541_init` (dev `cafe_db` and test `cafe_test_db` both migrated).

## Tests executed & results (this environment)
- **Unit + integration (Vitest + Supertest):** 25 passed / 0 failed
  (18 integration, 7 money unit). Command: `npm run test -w @cafe/api`.
- **Live smoke (PowerShell vs running API):** 17 passed / 0 failed
  (server pricing, idempotency, price-tamper, transitions, invalid transition, billing,
  overpayment rejection, **post-closure rejection**, saved-QR `canOrder=false`, RBAC 401/403).
- **Builds:** `@cafe/shared`, `@cafe/api`, `@cafe/web` all compile with `tsc`/Vite — clean.

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
builds ✓, migrations from clean DB ✓, seed ✓, auth/RBAC ✓, QR resolves table ✓,
customer orders during active session ✓, **server rejects orders after close** ✓,
duplicate submissions safe (idempotency) ✓, kitchen/waiter flows ✓, bills/payments consistent ✓,
unpaid-balance + unresolved-orders block close ✓, cross-table/IDOR rejected ✓,
critical automated tests pass ✓, error handling + logging ✓, setup/deploy/backup docs ✓.
Docker deployment and Playwright E2E remain **unverified** (disclosed above), not claimed complete.

## Next exact step
Run `docker compose up --build` on a Docker-enabled host to verify the containerized stack,
then add Playwright E2E for the four role interfaces if browser-level coverage is required.
