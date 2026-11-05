# Progress Ledger

## Current phase: QR-first mobile redesign (Phases 1–6, built and verified)

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
- **Phase 11** — **Frictionless ordering & PWA**:
  - **Customer-started sessions**: `POST /public/tables/:tableCode/start-session` creates a
    `PENDING` session (visible to the customer as "waiting for a waiter"; no session token is
    minted, so ordering rules are unchanged). Waiters confirm with one tap
    (`POST /staff/sessions/:sessionId/confirm` -> `ACTIVE`); the customer screen polls every 5 s
    while pending, so no manual refresh is needed.
  - **Customer self-service**: cancel a still-`QUEUED` dish (`POST /public/order-items/:itemId/cancel`)
    and view a live bill preview or generated snapshot (`GET /public/sessions/:sessionId/bill`).
    `Settings.upiId` powers a "Pay with UPI" deep link (`upi://pay?...`) on the tracking screen.
  - **Waiter UX**: rupee payment entry with exact/cash/UPI quick actions, full bill breakdown
    (lines, tax, service, rounding, paid, due), assistance-request resolution, audible/vibration
    alerts for ready dishes and help requests, and a 60 s fallback poll.
  - **Kitchen UX**: explicit "Enable sound" gesture (browsers block autoplay), Screen Wake Lock,
    and one-tap "mark this order's preparing items ready".
  - **Admin**: staff activate/deactivate, category create/hide, item create/price/86, and settings
    for currency, tax, service charge, rounding and UPI ID. Menu changes broadcast `menu.updated`
    to every connected screen.
  - **Hardening**: HTTP **and socket** auth now re-check `isActive`/role in the database on every
    request/connection; customer order submits silently re-resolve the QR once on a 401 and retry
    with the same idempotency key.
  - **PWA / performance**: `vite-plugin-pwa` (manifest, generated service worker, 192/512 icons),
    route-level `React.lazy` splitting, reconnect refetch + offline banner, and 60 s polling as a
    socket fallback. Fixed a menu bug where a plain "Add" (no variants/addons) opened the
    customizer instead of adding to the cart.
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
- **QR-first mobile redesign (commits b8726aa, 4889e00, dcd640f, fd59e96, 3f69f89, 348e694)** —
  additive, no Prisma migration, no existing public response shapes broken:
  - **Phase 1 / lazy sessions**: `POST /api/public/tables/:tableCode/session` idempotently
    opens/joins an `ACTIVE` session (row lock) and promotes legacy `PENDING` rows; closed-session
    orders still return `409 SESSION_CLOSED`. Dedicated non-login `system+self-service@cafe.local`
    actor; stricter `SESSION_RATE_LIMIT_MAX`; idle sweep auto-closes customer-opened sessions with
    zero orders after `CUSTOMER_SESSION_IDLE_TIMEOUT_MS`; realtime `session.opened`. 5 new
    integration tests (58 total).
  - **Phase 2 / brand**: warm cafe tokens in `index.css`, Fraunces + DM Sans self-hosted via
    Fontsource, staff token refresh.
  - **Phase 3 / customer app**: full `CustomerMenu`/`OrderTracking` rewrite with component split,
    sticky scroll-spy tabs, search, one-tap add for simple dishes, item/cart bottom sheets,
    cart persistence, stable idempotency key until cart changes or order succeeds, order stepper,
    polling fallback, haptics/toasts, invalid-QR/skeleton states, root landing page; Playwright
    e2e updated for the QR-first flow.
  - **Phase 4 / speed & PWA**: `viewport-fit=cover`, safe-area shell, Latin-only fonts + critical
    preload, manual vendor chunks, lazy `socket.io-client` import, and install/runtime caching
    (menu stale-while-revalidate; table lookup network-first).
  - **Phase 5 / admin QR**: A4 "Print active QR codes" sheet (6/page), QR error correction level M
    for render/download/print, "Test scan" affordance, localhost/`http:`/insecure-origin warning,
    rotate-QR warns about reprint and opens a replacement print preview, token styling cleanup.
  - **Phase 6 / staff**: light token pass over Kitchen/Waiter status colors; no role/flow rewrite.

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
- `20261023120000_frictionless_ux` — adds `SessionStatus.PENDING`, makes
  `DiningSession.openedBy` nullable (customer-requested sessions have no staff actor yet) and adds
  `Settings.upiId`. Applied to `cafe_db` and `cafe_test_db`; `prisma generate` rerun.

## Tests executed & results (this environment)
- **QR-first redesign (Phases 1–6, this run):**
  - `npm run typecheck` (`tsc -b`) — clean after each phase.
  - `npm test` — **58 passed / 0 failed** (39 integration, 12 order-state unit, 7 money unit;
    Vitest excludes `e2e/`). Phase 1 added 5 lazy-session/idle-sweep integration tests; all
    pre-existing session-closure and token tests remain green.
  - `npm run lint` — **0 errors** on the touched Phase 5/6 files; repo-wide lint still reports
    pre-existing advisory warnings/errors in older customer/staff surfaces (not introduced here).
  - `npm run build` — API + shared `tsc` and web `vite build` clean; PWA precaches 23 entries
    (~481 KiB). Web entry ~13 KB raw / 4.4 KB gzip; socket loaded lazily; fonts Latin-only.
  - `npm run test:e2e` — **1 passed** (360×800): QR browse (no auto-open), one-tap add, cart
    persists across reload, place order (lazy session open), second-device join, tracking, bill
    request, invalid QR error state.
  - **Admin QR live check (Playwright)**: localhost warning shown for dev `qrUrl`s; "Print active
    QR codes (18)" rendered 3 print sections × 6 cards = 18 cards, `window.print()` invoked once;
    print-media PDF export produced **3 A4 pages** with expected per-section heights.
- **Earlier Phase 11 (frictionless/PWA) baseline, still relevant:**
  - `npm test` previously **53 passed** before Phase 1's 5 additions.
  - `npm run test:e2e` previously covered the waiter-confirm flow; updated in Phase 3 to the
    QR-first lazy-open flow (still green).
  - `npx prisma migrate status` — up to date (no redesign migration required).
- **CI:** `.github/workflows/ci.yml` runs Postgres 16, migrate, seed, typecheck, lint, unit +
  integration tests, build, and the Playwright happy path (artifacts uploaded on failure).
- **Builds:** `tsc -b` and `vite build` are **clean**.

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
- Playwright E2E exists for the customer happy path only (360 px QR -> order -> tracking); the
  kitchen, waiter and admin UIs are still covered by integration tests and manual passes.
- Phase 9/5: scanning a downloaded/printed QR with a real phone camera is a manual check.
  Admin print-all layout was verified via Playwright `window.print` capture + print-media PDF (3
  A4 pages, 6 cards/page), but physical camera scans, printer margins, and paper scaling remain
  manual.
- Phase 9: case-insensitive duplicate table numbers are enforced in app code (the Postgres unique
  constraint on `number` stays case-sensitive); two simultaneous creates differing only by case
  could theoretically race past the check.
- Phase 6: staff screens received a light token pass, not a full UX rewrite.
- Repo-wide `npm run lint` reports pre-existing warnings/errors outside the Phase 5/6 touch set;
  touched files lint clean.
- Mobile rendering at ~360 px, iOS Safari safe-area/focus behavior, sound unlock, and Wake Lock
  still need real-device verification.

## Definition of Done status
Satisfied and **verified** in this environment (QR-first redesign Phases 1–6):
builds ✓, migrations current/no redesign migration needed ✓, seed ✓, auth/RBAC ✓, QR resolves table ✓,
**lazy QR session open/join is idempotent and server-enforced** ✓,
**closed-session orders still return 409 SESSION_CLOSED** ✓,
**stale session token cannot order or read into another/next session** ✓,
**per-item preparation tracked independently** ✓, **derived order summary recomputed** ✓,
**per-item RBAC + invalid-transition rejection** ✓, **immutable per-item event audit** ✓,
duplicate submissions safe (idempotency) ✓, kitchen per-dish ready + waiter per-dish served ✓,
ready-dish pickup queue ✓, bills/payments consistent (cancelled items excluded) ✓,
unpaid-balance + unresolved-orders block close ✓, cross-table/IDOR rejected ✓,
critical automated tests pass (**58**) ✓, QR-first e2e pass (**1**) ✓,
error handling + logging ✓, setup/deploy/backup docs ✓,
**admin Tables & QR: list/create/edit/deactivate/rotate, QR preview, PNG+SVG, single print, A4
print-all (6/page) with QR error correction M, test-scan affordance, localhost/insecure link
warning, rotate→reprint flow** ✓, **unique QR URL per table from configured base URL** ✓,
**case-insensitive duplicate labels rejected (409)** ✓, **inactive/unknown QR tokens → 404** ✓.
Docker deployment remains **unverified** (no Docker on this host), not claimed complete.
**Still manual:** scan a downloaded/printed QR with a real phone camera; walk admin/staff UIs in a
browser on a real iOS/Android device (safe-area, focus zoom, sound unlock, Wake Lock, haptics);
run Lighthouse on a production-like build/host.

## Next exact step
Run Lighthouse (mobile) against a production-like host, do a real-device QR camera + safe-area pass,
then add Playwright coverage for staff surfaces (kitchen mark-ready, waiter confirm/payment, admin
86/settings) and verify `docker compose up --build` on a Docker-enabled host. Re-point
`docs/smoke.ps1` at the item-level endpoints when convenient.
