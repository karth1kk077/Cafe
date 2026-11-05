# Application Context Brief — QR-Based Smart Café Ordering & Kitchen Management System

> **Purpose of this document.** This is a single, self-contained briefing that can be pasted
> whole into ChatGPT (or any other LLM) so it understands not just *what* this application is,
> but **how complete it actually is** — what is implemented, what is verified, what is only
> half-built, what exists in the schema but is unreachable, and what is outright broken.
>
> **Everything below was verified by reading the source and by running the build, typecheck,
> and test suite on 2026-10-22** (Node v24.16.0, npm 12.0.1, PostgreSQL 18.4).
> Where the repository's own docs disagree with the code, **the code wins** and the drift is
> called out explicitly in §12.

---

## 1. What this application is

A **QR-based self-service ordering system for a single café**, with staff-facing kitchen,
waiter, and admin interfaces.

A customer scans a QR code printed on the table. The QR encodes only an opaque table token —
never a table ID, session status, or any authorization claim. The server resolves that token,
and if the table has an open dining session, it mints a **signed, session-scoped customer
token**. The customer browses the menu on their own phone, customizes dishes, and places
orders. The kitchen (a phone screen) advances each dish independently from `QUEUED` to
`PREPARING` to `READY`. The waiter collects ready dishes from a pickup queue, marks each one
`SERVED`, generates a bill, records payment, and closes the dining session. An admin console
manages staff, the menu, tables, QR codes, café settings, and the audit log.

**The single defining rule of this codebase:**

> Orders are rejected after session close, **server-side**. There is no frontend-only
> enforcement anywhere.

A stale tab, a saved QR link, a reopened browser, or a hand-crafted request using an old
session token **cannot** order into the current or next session at that table. This is
enforced inside a database transaction under a `SELECT … FOR UPDATE` row lock, and it is
covered by dedicated integration tests.

### Scope and deliberate non-goals

| In scope (built) | Explicitly out of scope (by design, v1) |
|---|---|
| Single café, single currency (INR) | Multi-tenant / multi-outlet |
| Cash / staff-recorded payments only | Real payment gateway (UPI/card) |
| Per-dish preparation tracking | Order-level "accept / reject" workflow |
| Server-authoritative pricing | Client-side pricing |
| Account-less customer ordering | Customer accounts, logins, loyalty |
| Immutable bill snapshots | Discounts, refunds, voids, splits, transfers |
| Live updates via Socket.IO | Horizontal scaling of the socket layer |

---

## 2. Repository layout and size

```
cafe/                              (npm workspaces monorepo, "type": "module")
├─ apps/
│  ├─ api/          Express 5 + Socket.IO 4 API      → 24 files / 1,937 LOC
│  │                + 3 test files  /   735 LOC
│  ├─ web/          Vite 8 + React 19 SPA            → 13 files / 2,033 LOC
│  └─ (dist/ build output is committed-adjacent but gitignored)
├─ packages/
│  └─ shared/       Zod schemas + domain types        →  3 files /    87 LOC
├─ prisma/
│  ├─ schema.prisma (354 LOC, 17 models, 9 enums)
│  ├─ migrations/   2 migration folders  ⚠ SQL NOT COMMITTED (§12.1)
│  └─ seed.ts       (186 LOC)
├─ docker/          Dockerfile.api, Dockerfile.web, nginx.conf
├─ docs/            10 markdown files + smoke.ps1
├─ docker-compose.yml
└─ README.md, package.json, tsconfig.json, tsconfig.base.json, .env.example
```

**Total hand-written source: ~5,400 LOC** (API 1,937 + API tests 735 + web 2,033 + shared 87
+ prisma 540).

**Git history: 3 commits, clean working tree.**

| Commit | Content |
|---|---|
| `eb7daa0` | Initial commit: monorepo scaffolding, auth, menu, sessions, orders, billing, socket, kitchen + waiter + customer UIs |
| `59ceb63` | Item-level order tracking + session-scoped authorization (the big architectural correction) |
| `6ea65e2` | Tables & QR admin panel + mobile responsive / touch pass |

**Dependencies are pinned and current**: React 19, Vite 8, Tailwind CSS 4, React Router 7,
TanStack Query 5, Express 5, Socket.IO 4, Zod 4, Prisma 6, Vitest 3, Winston, Helmet,
bcryptjs, jsonwebtoken, express-rate-limit.

---

## 3. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript 5.9, ESM (`"type": "module"`) | Project references (`tsc -b`) across shared → api → web |
| Frontend | React 19, Vite 8, Tailwind CSS 4, React Router 7 | No component library; hand-rolled CSS utilities |
| Data fetching | TanStack Query 5 | Socket events invalidate/refetch — REST is the source of truth |
| Realtime | Socket.IO 4 (client + server) | Persist-then-notify |
| Backend | Node 24, Express 5 | TypeScript, ESM, `.js` import specifiers |
| Validation | Zod 4 | Shared schemas in `packages/shared` |
| ORM | Prisma 6 + PostgreSQL 18 | Two committed migrations, 2 Postgres sequences |
| Auth | jsonwebtoken + bcryptjs (12 rounds) | HttpOnly cookie **and** Bearer token |
| Logging | Winston | JSON, secrets redacted |
| HTTP hardening | helmet, cors (locked to `WEB_ORIGIN`), express-rate-limit | |
| Money | Integer **minor units (paise)** — never floats | Tax/service charge in **basis points** |
| Testing | Vitest 3 + Supertest (integration), PowerShell (smoke) | **No browser/E2E automation** |
| Containers | Dockerfile.api, Dockerfile.web + nginx, docker-compose | Written but **never executed** |

---

## 4. Architecture

### 4.1 Runtime shape

```
Customer phone ──QR scan /t/:qrToken──┐
Chef phone ───────────────────────────┤
Waiter browser ───────────────────────┤──► React SPA (apps/web)
Admin browser ────────────────────────┘         │
                                                 │  REST + JWT/x-session-token
                                                 │  Socket.IO (auth'd, server-derived rooms)
                                                 ▼
                                        Express 5 API (apps/api)
                                                 │
                                          Prisma │  Socket.IO server
                                                 ▼
                                        PostgreSQL 18
```

The SPA is a **single deployable** serving four role surfaces plus two customer surfaces.
Role separation is enforced by route guards in `App.tsx` **and** by server-side RBAC — the
guard is UX, the middleware is the security boundary.

### 4.2 Repository layering (API)

```
routes/      HTTP shape only: parse → delegate → respond
services/    All business logic + transactions + row locks
middleware/  authenticate (JWT), authorize (roles), requireCustomerSession
lib/         prisma, logger, errors, money, orderState, customerSession, qr, asyncHandler
config/      Zod-validated env, resolved from repo-root .env
```

Business rules live in `services/`. Routes never touch Prisma for domain logic beyond
simple reads. This is a consistent and respected convention throughout the codebase.

### 4.3 Realtime architecture

- Socket handshake authenticates with `auth.token`, which may be a **staff JWT** or a
  **customer session token**. The server distinguishes them by payload shape: a staff token
  must carry `id` + `role`; a customer token must carry `scope: "customer"` + `sessionId`.
  A customer token is **never** accepted as staff.
- **Rooms are assigned server-side. Clients cannot name their own room.**
  - Staff → `role:<ROLE>` and `user:<id>`
  - Customers → `session:<sessionId>` and `table:<tableId>`
- Events are **notifications, not source of truth**. State is persisted to PostgreSQL first;
  clients re-fetch over REST on any event and on reconnect.
- Events: `order.created`, `order.updated`, `order_item.status_changed`, `order_item.ready`,
  `order_item.served`, `bill.requested`, `session.closed`, `session.reopened`,
  `assistance_request.created`, `menu.updated` *(declared but never emitted — see §12.4)*.

---

## 5. Domain model

### 5.1 Entities (17 Prisma models)

| Model | Purpose | Key constraints |
|---|---|---|
| `User` | Staff accounts | unique email, `role` enum, `isActive` |
| `CafeTable` | Physical tables | unique `number`, unique 64-hex `qrToken`, `isActive` |
| `DiningSession` | One visit | FK table/user, status enum, `(tableId,status)` index |
| `MenuCategory` | Menu grouping | `isActive`, `sortOrder` |
| `MenuItem` | Dish | `priceMinor`, `dietaryTags[]`, `allergens[]`, `maxQuantity` (default 20) |
| `MenuItemVariant` | Size options | `priceDeltaMinor`, unique `(menuItemId,name)` |
| `MenuItemAddon` | Extras | `priceMinor`, unique `(menuItemId,name)` |
| `Order` | An order | unique `orderNumber`, **derived** status, snapshot money columns |
| `OrderItem` | Line item | name/price snapshotted, per-line `status`, `preparingAt`/`readyAt`/`servedAt`/`cancelledAt`/`cancelReason` |
| `OrderItemAddon` | Add-on snapshot | name + price snapshotted |
| `OrderItemEvent` | **Immutable** per-item audit trail | `fromStatus`/`toStatus`, actor, source (`STAFF`/`CUSTOMER`/`SYSTEM`), reason |
| `OrderStatusHistory` | Audit of the derived order summary | `(orderId,createdAt)` |
| `Bill` | Immutable billing snapshot | unique `billNumber`, snapshotted totals |
| `BillLineItem` | Bill lines | name/qty/unit price snapshotted from order items |
| `Payment` | Payment records | amount minor, method, **no card data** |
| `AssistanceRequest` | "Call waiter" | status `OPEN`/`IN_PROGRESS`/`RESOLVED` |
| `AuditLog` | Privileged-action log | actor/action/entity/metadata/IP |
| `IdempotencyKey` | Order dedup | unique `key`, FK session, `resourceId`, `expiresAt` (24 h) |
| `Settings` | Singleton café config | tax/service bps, currency, rounding toggle |

### 5.2 Line-item state machine (the core of the app)

```
                ┌──────────────────────────── CANCELLED ◄────────────┐
                │  (KITCHEN/WAITER/ADMIN)      │  (WAITER/ADMIN)    │  (ADMIN only)
                ▼                               │                   │
  QUEUED ──► PREPARING ─────────────────────► READY ──────────► SERVED
  (KITCHEN,ADMIN)   (KITCHEN,ADMIN)   (WAITER,ADMIN)        (terminal)
                                                        ▲
                                          CANCELLED ◄───┘ (ADMIN only)

  QUEUED ──────────────────────────► CANCELLED   (KITCHEN / WAITER / ADMIN)
  PREPARING ───────────────────────► CANCELLED   (WAITER / ADMIN — supervisor
                                                  authorization once prep starts)
  SERVED, CANCELLED = terminal
```

This table lives in exactly one place: `apps/api/src/lib/orderState.ts`
(`ITEM_TRANSITIONS`). The frontend never decides legality. Illegal jumps →
`409 INVALID_TRANSITION`. A role that may not perform the step → `403`.

### 5.3 Derived order summary

The order's `status` is **never written by a client**. It is recomputed from its line items
on every transition:

```
RECEIVED → IN_PROGRESS → PARTIALLY_READY → READY → COMPLETED
                                                       (or CANCELLED)
```

Derivation (cancelled items ignored): `COMPLETED` if every active item is `SERVED`; `READY`
if every active item is `READY`/`SERVED`; `PARTIALLY_READY` if some active item is
`READY`/`SERVED`; `IN_PROGRESS` if some item is `PREPARING`; otherwise `RECEIVED`. No active
items left ⇒ `CANCELLED`. Implemented in `deriveOrderSummary()`; 12 unit tests.

### 5.4 Dining session state machine

```
ACTIVE ──► BILL_REQUESTED ──► PAYMENT_PENDING ──► CLOSED
   ▲                                                  │
   └──────── admin reopen (audited, ADMIN only) ──────┘
```

Ordering is permitted **only** in `ACTIVE`. A table may have at most one non-closed session
(`409 SESSION_EXISTS`).

### 5.5 Money model

- All money is **integer minor units (paise)**. No floating point anywhere in the money path.
- Tax and service charge are **basis points** (500 = 5%), configured in the `Settings` singleton.
- Order totals: `subtotal + tax + serviceCharge + rounding → total`.
- Rounding: optional, to the nearest whole rupee; the delta is stored explicitly.
- **Bills are immutable snapshots** taken from the order items. Later menu edits never rewrite
  history. Cancelled line items are **excluded** from bills.
- `formatMoney()` in both API and web renders a hardcoded `₹` — the configurable `currency`
  field is stored but **not applied in the UI** (see §12.5).

---

## 6. The authorization model (read this before changing anything)

This is the most security-sensitive part of the codebase and the thing a future contributor
is most likely to break.

### 6.1 Staff

- JWT signed with `JWT_SECRET`, **12 h expiry**.
- Delivered **twice**: an HttpOnly cookie (`cafe_token`) *and* a JSON body token usable as
  `Authorization: Bearer <jwt>`.
- Passwords hashed with bcrypt (12 rounds by default, `BCRYPT_ROUNDS` configurable).
- Login rate-limited to **10 requests/minute/IP**.
- `authorize(...roles)` middleware is applied to **every** staff route. Hiding a button is
  never the enforcement point.
- `User.isActive` is checked **at login only**. An existing token keeps working until it
  expires (see §12.6).

### 6.2 Customers

Customers are **account-less**. The chain is:

1. `GET /api/public/tables/:qrToken` resolves the table. If it is inactive/unknown → `404`.
   If it has a session in `ACTIVE` → the server mints a **signed session token**:
   JWT with `{ scope: "customer", sessionId, tableId }`, **6 h expiry**.
2. The SPA stores it in `localStorage` under `cafe_session:<tableCode>` and sends it as the
   **`x-session-token`** header on every subsequent customer call, plus as the socket auth token.
3. **The server never trusts a client-supplied session or table id.** The session id always
   comes from the verified token's claim. `requireCustomerSession()` additionally compares the
   token's `sessionId` against the `:sessionId` route parameter, so swapping an id in the URL
   fails.
4. On `POST /api/public/orders`, the server takes the session id **from the token**, locks the
   session row `FOR UPDATE`, and re-checks `status === "ACTIVE"` **inside the transaction**.
   A closed session → `409 SESSION_CLOSED`. A stale token for a *previous* session at the same
   table → `409 SESSION_CLOSED`, and it can never silently reach the new session.

**Consequences that are deliberate and tested:**

- A saved/scanned QR link belonging to a closed session cannot order.
- Cross-session reads return **404**, not 403 (no existence oracle).
- The QR token is an *identifier*, never a credential. It contains no internal IDs, no status,
  no authorization claim.

---

## 7. API surface — 38 endpoints

Base URL `/api`. Staff auth: `cafe_token` HttpOnly cookie **or** `Authorization: Bearer <jwt>`.
Customer auth: `x-session-token: <session jwt>`.

Errors are uniform: `{ "error": { "code": string, "message": string, "details"? } }`.
Validation failures → `422`. All money fields end in `Minor` and are integers.

### 7.1 Health (2)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/ready` | Readiness (checks DB) |

### 7.2 Auth (3)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/login` | public | rate-limited 10/min; sets cookie; returns `{token,user}` |
| POST | `/auth/logout` | public | clears cookie |
| GET | `/auth/me` | any | current user |

### 7.3 Public / customer (7)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/public/menu` | public | categories + items + variants + addons + settings |
| GET | `/public/tables/:tableCode` | public | resolve QR → `{table,session,canOrder,sessionToken}`; rate-limited; no internal IDs; `404` for unknown/inactive |
| POST | `/public/orders` | `x-session-token` | body `{idempotencyKey, items[]}` — **no table/session/price fields**; server prices; `409 SESSION_CLOSED` |
| GET | `/public/orders/:orderId` | `x-session-token` | order + per-item status; `404` if not in the token's session |
| GET | `/public/sessions/:sessionId/orders` | `x-session-token` | all orders for the authorized session |
| POST | `/public/sessions/:sessionId/request-bill` | `x-session-token` | session → `BILL_REQUESTED` |
| POST | `/public/sessions/:sessionId/assistance` | `x-session-token` | create assistance request |

Order item input: `{menuItemId, variantId?, addonIds?, quantity, specialInstructions?}`.
Client-sent prices/totals are stripped by Zod and ignored.

### 7.4 Staff (26)

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/staff/tables` | any staff | tables + active session + open order items |
| POST | `/staff/tables` | ADMIN | create; trimmed number; seats optional; `409 DUPLICATE` (case-insensitive); generates 64-hex QR token; returns `{table,qrUrl}`; audited `TABLE_CREATED` |
| PATCH | `/staff/tables/:tableId` | ADMIN | number/seats/isActive; `{rotateQr:true}` rotates the token; audited (`TABLE_UPDATED`/`TABLE_DEACTIVATED`/`TABLE_ACTIVATED`/`TABLE_QR_ROTATED`) |
| GET | `/staff/admin/tables` | ADMIN | table list + `qrToken`, `qrUrl`, `activeSession` |
| POST | `/staff/tables/:tableId/sessions` | WAITER/ADMIN | open session; `409 SESSION_EXISTS` |
| GET | `/staff/sessions/:sessionId` | WAITER/ADMIN | session detail (orders, bills, assistance) |
| POST | `/staff/sessions/:sessionId/close` | WAITER/ADMIN | `409 UNPAID_BALANCE` / `409 UNRESOLVED_ORDERS` |
| POST | `/staff/sessions/:sessionId/reopen` | ADMIN | audited reopen |
| GET | `/staff/orders` | KITCHEN/WAITER/ADMIN | `?status=A,B` filter on derived summaries |
| GET | `/staff/orders/:orderId` | KITCHEN/WAITER/ADMIN | order detail + item statuses + history |
| GET | `/staff/order-items/ready` | WAITER/ADMIN | ready-dish pickup queue, oldest first |
| PATCH | `/staff/order-items/:itemId/status` | KITCHEN/WAITER/ADMIN | transition one item; role + legality enforced; `409 INVALID_TRANSITION` |
| POST | `/staff/order-items/:itemId/cancel` | KITCHEN/WAITER/ADMIN | cancel one item `{reason?}`; post-prep cancel needs supervisor |
| POST | `/staff/bills/generate` | WAITER/ADMIN | immutable snapshot; cancelled items excluded; returns the existing open bill if one exists |
| GET | `/staff/bills/:billId` | WAITER/ADMIN | bill + lines + payments |
| POST | `/staff/payments` | WAITER/ADMIN | `{billId,amountMinor,method,reference?}`; `409 OVERPAYMENT` / `409 ALREADY_PAID` |
| GET | `/staff/assistance` | WAITER/ADMIN | open requests |
| PATCH | `/staff/assistance/:id` | WAITER/ADMIN | update status (`OPEN`/`IN_PROGRESS`/`RESOLVED`) |
| GET | `/staff/admin/users` | ADMIN | list staff (no password hashes) |
| POST | `/staff/admin/users` | ADMIN | create staff; audited `USER_CREATED` |
| GET | `/staff/admin/audit` | ADMIN | audit logs, `?limit` (capped 200) |
| GET | `/staff/admin/settings` | ADMIN | café config |
| PATCH | `/staff/admin/settings` | ADMIN | cafeName / currency / taxRateBps / serviceChargeBps / roundingEnabled |
| POST | `/staff/admin/menu/categories` | ADMIN | create category |
| POST | `/staff/admin/menu/items` | ADMIN | create item |
| PATCH | `/staff/admin/menu/items/:itemId` | ADMIN | update name/description/price/availability |

**Error codes in use:** `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`,
`SESSION_CLOSED`, `IDEMPOTENCY_CONFLICT`, `DUPLICATE`, `SESSION_EXISTS`, `UNPAID_BALANCE`,
`UNRESOLVED_ORDERS`, `INVALID_TRANSITION`, `NO_OP_TRANSITION`, `ITEM_UNAVAILABLE`,
`QUANTITY_EXCEEDED`, `INVALID_VARIANT`, `INVALID_ADDON`, `EMPTY_ORDER`, `EMPTY_SESSION`,
`OVERPAYMENT`, `ALREADY_PAID`, `RATE_LIMITED`, `INTERNAL_ERROR`.

---

## 8. Frontend surfaces

Six routes (`apps/web/src/App.tsx`), one SPA, one build.

| Route | Component | Access | What it does |
|---|---|---|---|
| `/t/:tableCode` | `CustomerMenu` (343 LOC) | public | QR-scanned menu. Categories, dietary/allergen tags, variant + add-on + notes customizer sheet, cart with quantity steppers, idempotency key per submission, live order list, "ordering closed" banner when `canOrder=false`. |
| `/t/:tableCode/orders` | `OrderTracking` (139 LOC) | public | Per-dish status timeline (Ordered → Being prepared → Ready → Served), order totals, "Call waiter" and "Request bill" bottom bar, session-state banners. |
| `/login` | `LoginPage` (48 LOC) | public | Staff login; stores token, reconnects socket. |
| `/kitchen` | `KitchenPage` (193 LOC) | KITCHEN/ADMIN | Live order cards with table, order #, elapsed minutes, add-ons, special instructions. Per-dish "Start preparing" / "Mark ready". Filter chips (New / Preparing / Ready / All active). WebAudio beep on new order (toggleable). |
| `/waiter` | `WaiterPage` (334 LOC) | WAITER/ADMIN | Ready-to-serve pickup queue grouped by table + order with time-ready. Table grid with status colours and active-dish counts. Table sheet: open session, per-order item list, generate bill, record payment, close session, cancel item with reason. |
| `/admin` | `AdminPage` (172 LOC) + `TablesQrPanel` (483 LOC) | ADMIN | Five tabs: **Staff**, **Tables & QR**, **Menu**, **Audit**, **Settings**. |

**Admin → Tables & QR** is the most complete admin surface: list with search + status filter,
create/rename with trimmed labels and case-insensitive duplicate rejection, activate/deactivate,
rotate QR (with reprint warning), QR preview, **PNG + SVG download**, **copy link**, and a
**print-only sheet** (café name, table number, QR only — no admin chrome). QR images are
rendered client-side with the `qrcode` library, so **no image files are stored**.

### 8.1 Mobile / responsive pass (Phase 10)

Code-level only. Changes made: viewport meta no longer blocks pinch zoom; header + filter/tab
bars share one sticky wrapper (replacing fragile `top-[64px]`/`top-[72px]` offsets that drifted
when headers wrapped); new `.chip` class (36 px min hit area) for interactive filter buttons
while static status labels keep `.badge`; `.btn-sm` gains a 36 px min-height; cart steppers
and kitchen/waiter action buttons enlarged; form inputs bumped to **16 px** to stop iOS Safari
focus auto-zoom; fixed bottom bars and bottom sheets use a new `.pb-safe`
(`env(safe-area-inset-bottom)`) to clear the home indicator; sheets use `90dvh`.

---

## 9. Data integrity & concurrency

| Concern | Mechanism |
|---|---|
| Duplicate order submissions | `IdempotencyKey` with a **unique** key; retry on the same session returns the original order; reuse across sessions → `409 IDEMPOTENCY_CONFLICT` |
| Order-vs-session close race | `SELECT … FOR UPDATE` on the `DiningSession` row, then re-check `ACTIVE`, inside the same transaction as the insert |
| Two staff racing the same item transition | `SELECT … FOR UPDATE` on the `OrderItem` row → exactly one `200`, one `409`, no duplicate events |
| Concurrent session opening at one table | `FOR UPDATE` on the `CafeTable` row + an explicit `SESSION_EXISTS` check |
| Concurrent payments on one bill | `FOR UPDATE` on the `Bill` row, then recompute paid-so-far → `PARTIAL` / `PAID`; overpayment rejected |
| Order/bill number collisions | Postgres sequences `cafe_order_number_seq` / `cafe_bill_number_seq` (a legacy `count()+1` raced) |
| Price tampering | Server recomputes every line and total from the catalog; client prices are stripped by Zod |
| Menu edits rewriting history | Order and bill rows carry **snapshots** (name, unit price, line total, currency) |
| Multi-tab / multi-device double orders | Idempotency key + row locks |
| Staff-vs-customer token confusion on the socket | Payload-shape discrimination: staff requires `id`+`role`, customer requires `scope:"customer"`+`sessionId` |

Indexes are deliberate and documented in `docs/DB-DESIGN.md`: `(tableId,status)` on sessions,
`(sessionId,status)` and `(status,createdAt)` on orders, `(orderId)` and `(status,updatedAt)` on
order items, `(orderItemId,createdAt)` and `(orderId)` on item events, `(sessionId,status)` on
bills, `(entityType,entityId)` + `(createdAt)` on audit logs, unique on the idempotency key.

---

## 10. Verification status (re-run 2026-10-22)

### 10.1 What passes right now

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (`tsc -b` across shared/api/web) | **exit 0**, no errors |
| Production build | `npm run build` (api tsc, web tsc+vite, shared tsc) | **exit 0** — web bundle 408.36 kB / **125.19 kB gzip**, CSS 19.25 kB |
| Unit + integration tests | `npm run test -w @cafe/api` (Vitest) | **50 passed / 0 failed** in 4.51 s — 31 integration, 12 order-state unit, 7 money unit |
| Postgres reachable | `pg_isready -h localhost -p 5432` | accepting connections (PostgreSQL 18.4) |
| Environment | Node v24.16.0, npm 12.0.1 | |
| Docker | `docker --version` | **29.8.2 is installed** (the repo docs say it is *not* — see §12.3) |

The integration suite (`apps/api/src/__tests__/integration.test.ts`, 619 LOC) runs against a
**real** `cafe_test_db` and covers, in order: health/readiness · auth + RBAC (401/403) ·
session-scoped authorization (no token → 401, `canOrder=false` when no session) · server-side
pricing with a client lying about the total · idempotent retry · unavailable item ·
**stale token after close → 409** · **stale token cannot order into a new session at the same
table** · cross-session read → 404 · the full derived-summary progression · per-transition
role permissions (403) and illegal jumps (409) · cancel + no-op re-cancel · the ready-dish
queue · the immutable per-item event trail · close blocked by `UNRESOLVED_ORDERS` then by
`UNPAID_BALANCE` · cancelled items excluded from the bill · admin-only reopen + audit entry ·
overpayment rejection · duplicate active session → `409 SESSION_EXISTS` · QR token rotation
invalidating the old link · three concurrency races · and the whole admin Tables & QR suite
(RBAC, trimmed labels, 64-hex token, `qrUrl` shape, case-insensitive duplicate + rename
conflict → 409 `DUPLICATE`, blank → 422, deactivate → public 404 + audit entry).

### 10.2 What is NOT verified

- **The web app has zero automated tests.** No component tests, no hook tests, no jsdom setup.
  `npm run test` at the repo root runs only the API workspace's Vitest config.
- **No Playwright / Cypress / any browser automation.** The four role interfaces and the
  customer flow have no end-to-end coverage.
- **No automated Socket.IO tests.** The socket auth/room logic is security-critical and is
  covered only by manual reasoning.
- **The PowerShell smoke suite (`docs/smoke.ps1`) is broken** and has not been run against the
  current item-level API (§12.2).
- **The Docker/Compose stack has never been executed**, even though Docker is now installed.
- **The mobile pass is code-level only.** No rendering was verified at ~360 px, and iOS
  Safari behaviour (focus zoom, safe-area insets) and touch feel were never observed on a
  device.
- **No QR was ever scanned with a real phone camera**, including the downloaded PNG/SVG and
  the printed sheet.

---

## 11. Completeness assessment — the short version

**Overall: this is a genuinely functional, well-architected application — roughly 70–75%
complete against a production v1.** The *core loop* (QR → order → kitchen → waiter → bill →
close) is complete, server-enforced, and tested. What is missing is concentrated in
**admin surface depth, frontend test coverage, and production plumbing**.

### 11.1 Feature matrix

Legend — **✅ Complete** (implemented + server-enforced + tested) · **🟡 Partial** (works, but
narrower than the API allows, or untested) · **🔵 Schema-only** (modeled but unreachable) ·
**❌ Not started**

| Feature area | State | Notes |
|---|---|---|
| Monorepo, TS project refs, build | ✅ | `tsc -b` and `vite build` clean |
| Prisma schema (17 models, 9 enums) | ✅ | |
| Seed data (3 staff, 10 tables, 3 categories, 5 items) | ✅ | prints each table's `/t/<token>` |
| **Migration files committed to git** | ❌ | **Broken — see §12.1** |
| Staff auth (bcrypt, JWT, cookie+Bearer, rate limit) | ✅ | |
| RBAC on every staff route | ✅ | |
| Customer session token (the anti-stale-QR mechanism) | ✅ | the system's defining feature |
| Public menu read | ✅ | |
| Table resolution + session token minting | ✅ | |
| Order creation (transaction, repricing, idempotency, snapshot) | ✅ | |
| Per-item state machine + role gates | ✅ | 12 unit + integration |
| Derived order summary | ✅ | |
| Immutable per-item audit trail | ✅ | `OrderItemEvent` |
| Session open / request-bill / close / reopen | ✅ | close is correctly blocked |
| Billing snapshot, tax, service charge, rounding | ✅ | |
| Payment recording, partial payment, overpayment rejection | ✅ | |
| Socket.IO auth, server-derived rooms, persist-then-notify | 🟡 | **no automated tests** |
| Admin → Tables & QR panel | ✅ | full CRUD + PNG/SVG/print |
| Admin → Staff tab | 🟡 | create only; no edit / deactivate / delete; no `PATCH /admin/users` endpoint at all |
| Admin → Menu tab | 🟡 | create item only; **no edit, no price change, no availability toggle, no category creation in the UI** — the API supports all of these |
| Admin → Audit tab | 🟡 | flat list, no filters, no actor/metadata shown, 200-row cap |
| Admin → Settings tab | 🟡 | exposes cafeName + tax only; currency / service charge / rounding exist in the API but have no UI |
| Customer menu UI | ✅ | |
| Order tracking UI | 🟡 | no customer-visible bill/receipt — the customer can request a bill but never sees the amount |
| Kitchen UI | ✅ | |
| Waiter UI | 🟡 | no bill line-item breakdown; assistance requests are **read-only** (`PATCH /staff/assistance/:id` is never called); payment input takes raw **paise** in a plain text box |
| Mobile responsive pass | 🟡 | code-complete, never visually verified |
| Frontend unit/component tests | ❌ | 0 tests, 0 tooling |
| E2E (Playwright/Cypress) | ❌ | |
| Linting | ❌ | root `lint` script is `echo "lint placeholder"`; no ESLint config, no ESLint dependency |
| CI/CD | ❌ | no `.github/`, no pipeline of any kind |
| Docker / Compose deployment | 🟡 | written, never executed |
| Payment gateway | 🔵 | `ENABLE_GATEWAY_PAYMENTS` is declared in `.env.example` and **read by no code** |
| Discounts | 🔵 | `Bill.discountMinor` always `0`; no endpoint sets it |
| Bill void / payment refund | 🔵 | `BillStatus.VOID` and `PaymentStatus.REFUNDED` exist but nothing can ever set them |
| Order-level cancellation | ❌ | only per-item cancellation exists; `OrderStatus.CANCELLED` is reachable only as a derived summary |
| Table transfer / session split / bill split | ❌ | |
| Staff password reset / account unlock | ❌ | |
| Pagination on any list endpoint | ❌ | `GET /staff/orders` returns every order; audit caps at 200 |
| Observability beyond logs | ❌ | Winston console only; no metrics, request IDs, tracing, or error tracking |
| i18n / multi-currency | ❌ | `₹` hardcoded in both `formatMoney` implementations |
| Redis Socket.IO adapter (horizontal scale) | 🔵 | documented, not wired |
| CSRF token | 🔵 | deliberate — SameSite cookie + Bearer; documented as a known limitation |

### 11.2 Rough LOC picture of the remaining work

Roughly: ~400 LOC to make the admin UI match its own API surface, ~200 LOC for the waiter
bill breakdown + assistance resolution + currency-formatted payment input, ~150 LOC for a
customer receipt view, plus an unbounded but tractable amount for frontend tests, linting,
CI, pagination, and observability.

---

## 12. Known defects, gaps, and documentation drift

These were found by reading the code and comparing it against the repository's own docs.
**The first item is a genuine blocker for anyone cloning this repo.**

### 12.1 ⚠ CRITICAL — migration SQL files are not committed to git

`.gitignore` contains:

```gitignore
prisma/migrations/*/migration.sql
!prisma/migrations
```

The negation `!prisma/migrations` re-includes the **directory** but not the `.sql` files
inside it. Verified with `git check-ignore -v` — both migration files match the ignore rule
— and by cloning the repo to a temp directory, where `prisma/` contains only
`schema.prisma`, `seed.ts`, and `migrations/migration_lock.toml`.

**Consequence:** a fresh clone has **no migrations**. `prisma migrate deploy` applies
nothing, the database has no tables, and the API fails at the first query. The setup
instructions in `docs/DEPLOYMENT.md` (`npm run db:migrate -- --name init`) would attempt to
create a new baseline against an already-correct `schema.prisma` and fail or produce drift.

**Fix:** delete the two `prisma/migrations/*/migration.sql` lines from `.gitignore` and
`git add -f` the existing migration files. Nothing else needs to change — the migration
content is correct and `prisma migrate diff` reports no drift on the live databases.

### 12.2 `docs/smoke.ps1` is broken and hardcodes an absolute path

Line 4 reads:

```powershell
$token1 = (psql -U postgres -h localhost -d cafe_db -t -A -f "C:\Users\Karth\Desktop\cafe\docs\gettoken.sql").Trim()
```

- `docs/gettoken.sql` **does not exist in the repo** (the script fails on its first DB call).
- The path is a machine-specific absolute path — it will never work on another machine.
- The script was written for the pre-item-level contract and has not been re-run since.
- `docs/PROGRESS.md` correctly flags that the last "17/17" result *predates* the item-level
  change and should not be re-claimed. It should be deleted or rewritten, not left to fail.

### 12.3 `docs/PROGRESS.md` claims Docker is not installed — it is

> "**Docker is NOT installed** on this machine, so `docker compose up` was not executed here"

Docker **29.8.2** is installed on this host right now. The compose stack and both
Dockerfiles have therefore never been executed despite being buildable — this is now a
verifiable gap rather than an environmental excuse.

### 12.4 `docs/TESTING.md` reports a stale test count

It says "**46 passed / 0 failed** (27 integration, 12 order-state unit, 7 money unit)".
The actual count is **50 passed** (31 integration + 12 + 7). `docs/PROGRESS.md` has the
correct number; `docs/TESTING.md` does not.

### 12.5 `docs/SETUP.md` is empty (0 bytes)

The README says *"See docs/SETUP.md"* and the README's doc list includes it, but the file has
**no content at all**. The actual setup instructions live inside `docs/DEPLOYMENT.md` under
"Local development". The README also lists `docs/API.md` etc. — those are fine.

### 12.6 Deactivated staff keep access until their JWT expires

`User.isActive` is checked at **login** (`authService.ts`) but **not** in the
`authenticate()` middleware, which only verifies the JWT signature and payload shape.
A staff account deactivated (or a password changed) continues to work until the existing
12-hour token expires. There is no token revocation list and no refresh token.

Related: the staff JWT is stored in `localStorage` (`cafe_token`) in addition to the HttpOnly
cookie. The cookie is the safer channel; the `localStorage` copy is XSS-exposed and is what
the socket authenticates with.

### 12.7 Dead code and unreferenced declarations

| Symbol | Location | Issue |
|---|---|---|
| `emitMenuUpdated` / `menu.updated` | `apps/api/src/socket/index.ts` | Declared and exported but **never called**. `docs/API.md` lists `menu.updated` as an emitted event — it never fires. |
| `getItemEvents` | `apps/api/src/services/orderItemService.ts` | Never called. The `OrderItemEvent` audit trail is written but **no endpoint exposes it**, so the customer/admin cannot read the per-item history that the schema exists to provide. |
| `assertActiveSessionByTableCode` | `apps/api/src/services/menuService.ts` | Never called. |
| `MoneySchema` | `packages/shared/src/schemas.ts` | Exported, never imported. |
| `table:<tableId>` socket room | `apps/api/src/socket/index.ts` | Customers join it; **nothing ever emits to it**. |
| `OrderItemEvent.orderId` | `prisma/schema.prisma` | Denormalized plain string with **no FK** to `Order` — no referential integrity on the audit trail. |
| `Bill.discountMinor` | `prisma/schema.prisma` | Always `0`; no write path. |
| `BillStatus.VOID`, `PaymentStatus.REFUNDED` | `prisma/schema.prisma` | Unreachable states. |
| `ENABLE_GATEWAY_PAYMENTS` | `.env.example` | Referenced by no code. |

### 12.8 `packages/shared` is largely bypassed

The same enums exist in **three** places:

- `packages/shared/src/types.ts` — `Role`, `OrderStatus`, `OrderItemStatus`, `BillStatus`, …
- `apps/api/src/lib/orderState.ts` — re-declares `ItemStatus` and `OrderSummary` locally.
- `apps/web/src/lib/api.ts` — re-declares `OrderStatus` and `OrderItemStatus` locally.

Only the **Zod schemas** are genuinely shared (API → shared). The type duplication is a
drift risk: adding a status value requires editing three files and nothing catches a miss.

### 12.9 `CafeTable.status` duplicates `DiningSession.status`

Table state is stored twice and updated by hand in each service (`sessionService` sets
`OCCUPIED` / `BILL_REQUESTED` / `PAYMENT_PENDING` / `AVAILABLE`). The two can drift, and
there is no constraint keeping them consistent.

### 12.10 The `table:<id>` room, and the polling redundancy

`KitchenPage` polls every 15 s and `WaiterPage`'s ready queue every 20 s **in addition** to
socket events. This is defensible as belt-and-braces (it covers dropped sockets), but it is
unexplained duplication that multiplies DB load as the order count grows.

### 12.11 Admin surfaces are shallower than the API they front

The API supports far more than the UI exposes. Specific gaps:

- **Menu**: `PATCH /admin/menu/items/:itemId` (edit name/price/availability) and
  `POST /admin/menu/categories` exist but the Admin UI **never calls either**. An admin
  cannot change a price or mark an item sold out from the UI. `imageUrl` and
  `dietaryTags`/`allergens` cannot be set either.
- **Staff**: no `PATCH /admin/users` endpoint exists at all; the UI can only create users.
- **Settings**: `currency`, `serviceChargeBps`, `roundingEnabled` have no UI controls.
- **Audit**: no filters, no actor or metadata rendering, no export.
- **Assistance**: `PATCH /staff/assistance/:id` exists but `WaiterPage` never calls it, so a
  request stays `OPEN` forever from the UI's point of view.
- **Bills**: `GET /staff/bills/:billId` (with `lineItems` and `payments`) exists but the
  waiter UI shows only the total.

### 12.12 Operational gaps

- **Rate limiting is in-process and in-memory.** It resets on restart and is not shared
  across instances.
- **No pagination** on any list endpoint.
- **No metrics, request IDs, tracing, or frontend error tracking.**
- **`npm run dev` at the repo root is a no-op** (`echo` + `exit 0`); you must run
  `npm run dev:api` and `npm run dev:web` in separate terminals.
- **No `engines` field, no `.nvmrc`** in `package.json`.
- **No CI.** Nothing prevents a regression from landing.
- **No linting.** The `lint` script is a placeholder; ESLint is not installed, yet the
  source contains `eslint-disable-next-line` comments that do nothing.

### 12.13 The `docs/smoke.ps1` / docs `gettoken.sql` / `focus.ps1` triad

`docs/PROGRESS.md` mentions `docs/smoke.ps1/focus.ps1 + SQL helpers`, but only `smoke.ps1`
exists in `docs/`. `focus.ps1` and the SQL helper were never committed.

---

## 13. Conventions a contributor must respect

These are not preferences — breaking them reintroduces bugs that were deliberately fixed.

1. **Never trust client-supplied session, table, or price.** Session id comes from the
   verified token; prices come from the catalog. The client is a hostile input.
2. **Never enforce authorization in the frontend.** `authorize(...roles)` and
   `requireCustomerSession()` are the security boundary. UI guards are cosmetic.
3. **Never write `Order.status` directly.** It is a derived summary. Call
   `deriveOrderSummary()` after every item transition.
4. **All item transitions go through `transitionOrderItem()`.** It holds the row lock,
   validates against `ITEM_TRANSITIONS`, writes the `OrderItemEvent`, writes the `AuditLog`,
   and recomputes the summary. Do not add a second path.
5. **Money is integer minor units.** Use `apps/api/src/lib/money.ts`. No floats.
6. **Persist, then notify.** Write to PostgreSQL first, then emit the socket event. Events
   are hints; REST is the truth. Never emit before the transaction commits.
7. **Lock the row before you check it.** `FOR UPDATE` on sessions, items, and bills. This is
   what makes the concurrency guarantees real.
8. **Socket rooms are server-derived.** Never accept a room name from the client.
9. **Names and prices are snapshots.** Copy them onto order/bill rows; never join back to
   the catalog for historical display.
10. **Every privileged action writes an `AuditLog` entry.**
11. **The `qrToken` is an identifier, not a credential.** It must never encode state, IDs,
    or entitlements.
12. **Use the existing error classes** (`UnauthorizedError`, `ForbiddenError`,
    `NotFoundError`, `ConflictError`, `SessionClosedError`) so the centralized error handler
    produces the right status and code.
13. **Keep the `.js` extension on relative imports** — the API is ESM.

---

## 14. How to run, verify, and extend

### 14.1 Local setup (the working version — `docs/SETUP.md` is empty, use this)

```bash
npm install
cp .env.example .env          # then edit DATABASE_URL and the two secrets

# Point DATABASE_URL at a Postgres instance, then:
npm run db:generate            # prisma generate
npx prisma migrate deploy --schema prisma/schema.prisma   # ⚠ only works if the migration SQL is committed (see §12.1)
npm run db:seed                # staff + 10 tables + menu

# Terminal 1
npm run dev:api                # http://localhost:4000

# Terminal 2
npm run dev:web                # http://localhost:5173  (proxies /api + /socket.io to :4000)
```

Seeded logins (password `Password123!`): `admin@cafe.local`, `waiter@cafe.local`,
`chef@cafe.local`. The seed prints each table's `/t/<qrToken>` route.

### 14.2 Verification commands

```bash
npm run typecheck              # tsc -b across shared → api → web
npm run build                  # api tsc, web tsc + vite, shared tsc
npm run test -w @cafe/api      # Vitest: 50 tests (31 integration + 19 unit)
npm run test:watch -w @cafe/api
```

Integration tests need a separate PostgreSQL database, `cafe_test_db`, configured in
`apps/api/vitest.config.ts`. They never touch dev data.

### 14.3 Docker

```bash
docker compose up --build      # postgres :5432, api :4000, web :8080
```

Note that `docker-compose.yml` hardcodes `JWT_SECRET=change-me-in-production` and
`COOKIE_SECURE="false"` — **override both** before using it anywhere real.

### 14.4 If you extend the item lifecycle

1. Add the status to `OrderItemStatus` in `prisma/schema.prisma` **and** create a migration.
2. Add the transition to `ITEM_TRANSITIONS` in `apps/api/src/lib/orderState.ts`.
3. Add the timestamp mapping in `timestampFieldFor()`.
4. Update `deriveOrderSummary()` if the new state affects the summary.
5. Mirror the type in `packages/shared/src/types.ts` **and** `apps/web/src/lib/api.ts`
   (see §12.8 — three copies, sadly).
6. Add unit tests to `apps/api/src/lib/orderState.test.ts` and integration tests to
   `apps/api/src/__tests__/integration.test.ts`.
7. Update `docs/API.md`, `docs/ARCHITECTURE.md`, and the checklist in
   `docs/ACCEPTANCE-TESTS.md`.

---

## 15. Recommended next work, in priority order

| # | Item | Why | Est. size |
|---|---|---|---|
| 1 | **Un-ignore and commit the migration SQL** | A fresh clone cannot build a database. This blocks every other contributor. | 2 lines |
| 2 | **Write `docs/SETUP.md`** (or delete it and fix the README) | The README points at an empty file. | S |
| 3 | **Fix or delete `docs/smoke.ps1`** and add the missing `gettoken.sql`; remove the absolute path | A broken test script is worse than none — it looks like coverage. | S |
| 4 | **Add ESLint + a real `lint` script** | There is no static analysis at all today. | M |
| 5 | **Add CI** (typecheck + build + test) | Nothing guards the 50 tests. | S |
| 6 | **Frontend tests** (Vitest + jsdom + Testing Library) for the API client, the order-state UI mapping, and the session-token lifecycle | The web app is 2,033 LOC with zero coverage, and it holds the customer-facing security logic. | L |
| 7 | **Expose the missing admin/staff actions in the UI** — menu edit/price/availability, category create, staff edit/deactivate, settings for currency/service charge/rounding | The APIs already exist; this is pure UI work against a stable contract. | M |
| 8 | **Waiter bill breakdown + assistance resolution + currency-formatted payment input** | The waiter currently types raw paise and cannot resolve a "call waiter" request. | M |
| 9 | **Customer-visible bill/receipt** | The customer can request a bill but cannot see what they owe. | M |
| 10 | **Expose `OrderItemEvent` via an endpoint** and surface the per-item audit trail | The data is already being written; it is unreachable. | S |
| 11 | **Check `User.isActive` in `authenticate()`** and add token revocation | Deactivated staff currently keep access for up to 12 h. | S–M |
| 12 | **Emit `menu.updated`** from the admin menu endpoints (or remove the event) | The contract promises an event that never fires. | S |
| 13 | **Collapse the three duplicated enum definitions** into `packages/shared` | Drift risk that will bite on the next status change. | S |
| 14 | **Add pagination** to `GET /staff/orders`, `GET /admin/audit`, `GET /staff/tables` | Unbounded list growth. | M |
| 15 | **Run `docker compose up --build`** and record the result | Docker is installed; the stack is untested. | S |
| 16 | **Playwright E2E for the four role interfaces** | Closes the "no browser automation" gap that every phase has deferred. | L |
| 17 | **Add request IDs + basic metrics** | Currently only console logs exist. | M |

---

## 16. One-paragraph summary to give to ChatGPT

> This is a production-minded **QR-based café ordering system** built as a TypeScript npm
> monorepo: an Express 5 + Socket.IO + Prisma/PostgreSQL API and a React 19 + Vite 8 SPA
> serving four role surfaces (customer, kitchen, waiter, admin). The core loop is complete,
> server-enforced, and covered by 50 passing automated tests. Its defining property is that
> **ordering is authorized by a signed, session-scoped customer token minted from the QR
> table lookup, and the server re-validates `ACTIVE` under a `SELECT … FOR UPDATE` row lock
> inside the order transaction — so a stale tab, a saved QR link, or a hand-crafted request
> cannot order into a closed or subsequent session**; this is enforced server-side only, never
> in the frontend. Preparation is tracked **per line item** (`QUEUED → PREPARING → READY →
> SERVED`, plus `CANCELLED`) through a single central transition table with role gates, an
> immutable `OrderItemEvent` audit trail, and an order-level status that is a **derived
> summary** recomputed on every transition. Money is integer minor units (paise) with
> basis-point tax, server-side repricing, and immutable bill snapshots. **Roughly 70–75%
> complete for a production v1**: the core is solid, but the admin UI is much thinner than
> the API behind it (no menu editing, no category creation, no staff editing), the waiter UI
> lacks a bill breakdown and cannot resolve assistance requests, there is **no customer
> receipt**, **zero frontend tests, no E2E, no linter, no CI, no pagination**, and the
> Docker stack has never been run. One concrete blocker: **the Prisma migration SQL files are
> excluded by `.gitignore`, so a fresh clone has no migrations at all** — fix that first.
> Payments are cash-only by design (no gateway), and discounts/voids/refunds exist in the
> schema but are unreachable.

---

*Generated 2026-10-22 against commit `6ea65e2` on branch `main`, working tree clean.
All status claims in §10 were re-verified by running the commands on that date; all claims
in §12 were verified by reading the source and by cloning the repository to a scratch
directory.*
