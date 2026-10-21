# Progress Ledger

## Current phase: Phase 10 — Mobile responsive & touch pass (built; visual phone pass pending)

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
- **Phase 9** — **Admin → Tables & QR Codes**: admin-only `GET /staff/admin/tables` returning
  `qrToken` + canonical `qrUrl`; create/rename/activate/deactivate/rotate with trimmed labels and
  case-insensitive duplicate rejection (409 `DUPLICATE`); audit actions `TABLE_CREATED`,
  `TABLE_DEACTIVATED`, `TABLE_ACTIVATED`; QR URLs built from the new `PUBLIC_APP_BASE_URL` env var
  (default `WEB_ORIGIN`); rate-limited public QR lookup; internal table ID removed from the public
  payload. New admin tab "Tables & QR" (`TablesQrPanel`) with list/search/filter, add/edit forms,
  confirmations, QR preview, PNG + SVG download, copy link, and a print-only sheet (client-side
  rendering via the `qrcode` library; no image files stored).
- **Phase 10** — **Mobile responsive & touch pass** across every surface (login, customer menu,
  order tracking, kitchen, waiter, admin). Layout/interaction only, no behavior changes:
  viewport meta no longer blocks pinch zoom (`maximum-scale`/`user-scalable` removed); header +
  filter/tab bars on Kitchen/Admin/CustomerMenu now share one sticky wrapper instead of the
  fragile `top-[64px]`/`top-[72px]` offsets (which drifted when headers wrapped); new `.chip`
  class (36 px min hit area) replaces `.badge` on all interactive filter/selector buttons while
  static status labels keep `.badge`; `.btn-sm` gains a 36 px min-height; cart quantity steppers
  and kitchen/waiter action buttons enlarged; form inputs bumped to 16 px to stop iOS Safari's
  focus auto-zoom; fixed bottom bars and bottom sheets use a new `.pb-safe`
  (`env(safe-area-inset-bottom)`) so they clear the home indicator; sheets use `90dvh`.

## Files created (high level)
- apps/api: config, lib (logger, prisma, errors, money, asyncHandler, **orderState**,
  **customerSession**, **qr**), middleware (auth, errorHandler), services (auth, menu, session, order,
  **orderItem**, billing), routes (health, auth, public, staff), socket, app, index;
  vitest config + tests.
- apps/web: Vite React app (customer menu, order tracking, login, kitchen, waiter, admin),
  api/socket/auth libs + **session** helper, components/ **TablesQrPanel** (Tables & QR tab),
  Tailwind styles (+ `.btn-sm`), `qrcode` + `@types/qrcode` deps.
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
- **Phase 9 required no migration** — `CafeTable` already carries unique `number`/`qrToken`,
  `isActive`, and timestamps. `prisma migrate status` reports "Database schema is up to date!".

## Tests executed & results (this environment)
- **Unit + integration (Vitest + Supertest): 50 passed / 0 failed**
  (31 integration, 12 order-state unit, 7 money unit). Command: `npm run test -w @cafe/api`.
  The integration suite covers the item-level lifecycle, derived summary, per-item RBAC and
  invalid-transition rejection, the ready-dish queue, `OrderItemEvent` audit, cancelled-item
  billing, and the critical session-token cases (no token → 401; stale token after close → 409;
  stale token cannot order into a new session at the same table; cross-session read → 404).
  **Phase 9 additions:** admin tables list RBAC (waiter 403), QR URL/token shape + `TABLE_CREATED`
  audit, trimmed labels, blank → 422, case-insensitive duplicate + rename conflict → 409
  `DUPLICATE`, deactivate → public lookup 404 + `TABLE_DEACTIVATED` audit. The pre-Phase-9 suite
  was repeated 17× consecutively with 0 failures; the Phase 9 suite has been run green twice (its
  first run caught an over-long test label, which the API correctly rejected with 422).
- **Live smoke vs running API (this change):** admin login, admin table list (10 seeded tables,
  `qrUrl = http://localhost:5173/t/<token>`), create (trim + seats + 64-char token), public resolve
  (no internal table ID), uppercase duplicate → 409, deactivate → public 404, audit rows
  `TABLE_CREATED`/`TABLE_DEACTIVATED` — all as expected (see ledger run log in this change).
- **Live smoke (PowerShell vs running API):** 17 passed / 0 failed
  (server pricing, idempotency, price-tamper, transitions, invalid transition, billing,
  overpayment rejection, **post-closure rejection**, saved-QR `canOrder=false`, RBAC 401/403).
  *Note:* the smoke script was written for the pre-item-level contract; it has not been re-run
  against the item-level API (kept as historical evidence, not re-claimed).
- **Builds:** `tsc -b` (project references across shared/api/web) and `vite build` are **clean**.
  (A prior ledger line claiming clean builds/tests was corrected here: the earlier 25-test count
  predated this change.)
- **Phase 10 (mobile pass):** `npm run typecheck` and `npm run build -w @cafe/web` re-run green
  after the changes; the production CSS bundle was checked to contain `.chip`/`.pb-safe` and no
  remaining `top-[64px]`/`top-[72px]` offsets. No API change, so the 50-test suite was not
  re-run for this phase (nothing it covers was touched).

## Environment notes
- Node 24, npm 12, PostgreSQL 18 (local). **Docker is NOT installed** on this machine, so
  `docker compose up` was not executed here; compose + Dockerfiles are provided and documented
  but **unverified in this environment**. Local Postgres was used instead.
- `PUBLIC_APP_BASE_URL` (new, optional) is the public origin encoded into table QR codes; it
  defaults to `WEB_ORIGIN`, so dev/test need no config. Set it explicitly in production
  (e.g. `https://cafe.example`). Verified live: default → `http://localhost:5173/t/<token>`,
  override → `https://cafe.example/t/<token>`.

## Known issues / limitations
- Docker image build/run unverified (no Docker on host).
- No real payment gateway (cash/staff-recorded only) — by design for v1.
- No CSRF token (auth uses SameSite cookie + Bearer); revisit if `SameSite=none` is enabled.
- Socket horizontal scaling needs the Redis adapter (documented, not wired).
- Playwright E2E not set up (integration + smoke cover the critical flows).
- Phase 9: scanning the rendered/downloaded/printed QR with a real phone camera is a manual check
  (no browser automation here); QR images are generated client-side, so the UI itself needs a
  browser pass — checklist in `docs/ACCEPTANCE-TESTS.md` under "Admin → Tables & QR Codes".
- Phase 9: case-insensitive duplicate table numbers are enforced in app code (the Postgres unique
  constraint on `number` stays case-sensitive); two simultaneous creates differing only by case
  could theoretically race past the check.
- Phase 9: no bulk multi-table print sheet (explicitly out of scope in the plan); print is
  one table at a time.
- Phase 10: the mobile pass is **code-level only** — no browser/emulator automation exists in this
  environment, so actual rendering at ~360 px, iOS Safari behavior (focus zoom, safe-area), and
  touch feel on a real device were **not visually verified**.

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
critical automated tests pass ✓, error handling + logging ✓, setup/deploy/backup docs ✓,
**admin Tables & QR page (list/create/edit/deactivate/rotate, QR preview, PNG+SVG+print, copy
link) built and typechecked** ✓, **unique QR URL per table from configured base URL** ✓,
**case-insensitive duplicate labels rejected (409)** ✓, **inactive/unknown QR tokens → 404** ✓,
**order submission revalidates session on the server (pre-existing, still green)** ✓,
public payload carries no internal IDs ✓.
Docker deployment and Playwright E2E remain **unverified** (disclosed above), not claimed complete.
The PowerShell smoke suite has not been re-run against the item-level API (see Tests above).
**Still manual:** scan a downloaded/printed QR with a real phone camera and walk the admin UI in a
browser (`docs/ACCEPTANCE-TESTS.md` → "Admin → Tables & QR Codes"), because this environment has no
browser automation.

## Next exact step
Run the new "Admin → Tables & QR Codes" checklist in `docs/ACCEPTANCE-TESTS.md` in a browser
(`npm run dev:api` + `npm run dev:web`, log in as admin@cafe.local), including a real phone-camera
scan of a downloaded PNG and a printed sheet. While in the browser, do the Phase 10 mobile check:
resize to ~360 px (or a real phone) and confirm each surface — no horizontal scroll, category/tab
bars stick below the header, chips and steppers are comfortable to tap, no iOS focus zoom on
inputs, and bottom bars clear the home indicator. After that: re-point `docs/smoke.ps1` at the
item-level endpoints, verify `docker compose up --build` on a Docker-enabled host, and add Playwright
E2E for the four role interfaces if browser-level coverage is required.
