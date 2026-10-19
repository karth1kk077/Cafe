# Architecture

## Overview
QR-Based Smart Café Ordering and Kitchen Management System. A monorepo with a customer QR
ordering interface, a chef's phone kitchen display, a waiter dashboard, and an admin console,
backed by an Express + Socket.IO API and PostgreSQL.

## Technology decisions
- **Frontend**: React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 7, TanStack Query 5,
  React Hook Form + Zod, Socket.IO client.
- **Backend**: Node 24, Express 5, Socket.IO 4, Zod 4 validation, Winston logging, Helmet,
  CORS, express-rate-limit, bcryptjs password hashing, JWT (HttpOnly cookie + Bearer).
- **Database**: PostgreSQL 18, Prisma ORM with versioned migrations.
- **Money**: all amounts stored as integer minor units (paise). Never floating point.
- **Testing**: Vitest + Supertest (integration), PowerShell smoke suite against a live server.

Alternatives were not needed; the stack meets all requirements without compatibility issues.

## Repository layout
```
apps/api      Express + Socket.IO API (routes, services, middleware, socket)
apps/web      Vite React SPA (customer, kitchen, waiter, admin)
packages/shared  Zod schemas + shared types/contracts
prisma        schema.prisma, migrations, seed.ts
docs          architecture, DB, API, security, testing, deployment, progress
```

## System architecture (Mermaid)
```mermaid
flowchart TD
  C[Customer phone] -->|QR scan /t/:qrToken| W[Web SPA]
  K[Chef phone] --> W
  Wt[Waiter browser] --> W
  A[Admin browser] --> W
  W -->|REST + JWT| API[Express API]
  W <-->|Socket.IO (auth'd rooms)| API
  API -->|Prisma| DB[(PostgreSQL)]
  API --> S[Socket.IO server]
  S -->|rooms: role:*/session:*| W
```

## Real-time architecture
- Socket connections are authenticated with `auth.token`, which may be either a staff JWT or a
  customer **session token**. The server distinguishes them by payload shape: a staff token must
  carry `id` + `role`; a customer token must carry `scope:"customer"` + `sessionId`.
- Rooms are assigned **server-side** and clients cannot name their own room:
  staff join `role:<ROLE>` (and `user:<id>`); customers join `session:<sessionId>` (and
  `table:<tableId>`) derived from their verified token.
- Events are **notifications, not source of truth**. State is persisted in PostgreSQL first;
  clients re-fetch over REST after any event and on reconnect.
- Events: `order.created`, `order.updated`, `order_item.status_changed`, `order_item.ready`,
  `order_item.served`, `bill.requested`, `session.closed`, `session.reopened`,
  `assistance_request.created`, `menu.updated`.
- Scaling beyond one instance: swap the default in-memory Socket.IO adapter for the Redis
  adapter (`@socket.io/redis-adapter`) and put the API behind a load balancer with sticky
  sessions or Redis-backed pub/sub. Postgres remains the durable store.

## Critical business flow (order lifecycle)
1. QR resolves a table by unpredictable `qrToken` — the QR is an identifier, not a credential.
   When an orderable session exists the API mints a signed **session token**
   (`{scope:"customer", sessionId, tableId}`) that the customer client stores and sends as
   `x-session-token`.
2. Customer browses menu; cart is client-side only and grants no authorization.
3. On submit, the server (in a transaction):
   - verifies the session token and takes the **session id from the token** (never from the body),
   - locks that session row `FOR UPDATE`,
   - rejects unless the session is `ACTIVE` (post-closure rule),
   - replays idempotency key scoped to the session if present,
   - recomputes all prices/totals from the catalog (client prices ignored),
   - snapshots item names/prices/modifiers onto the order,
   - creates each item in `QUEUED` and writes the order + status history + item events +
     idempotency record.
4. Kitchen receives `order.created` and moves **each line item** independently
   `QUEUED → PREPARING → READY`; each accepted transition emits `order_item.status_changed`
   (and `order_item.ready` at READY).
5. Waiter collects ready dishes from the queue and marks each `READY → SERVED`
   (`order_item.served`), then generates an immutable bill snapshot, records payment, then closes
   the session.
6. After closure the session can never accept orders again unless an admin reopens it (audited);
   a stale tab holding the old session token is rejected with `409 SESSION_CLOSED`.

## Order state machine (per line item + derived summary)
Preparation is tracked per line item. The order's `status` is a **derived summary**, recomputed
from its items on every transition and never written by a client.

```
Item:   QUEUED -> PREPARING -> READY -> SERVED
           |          |          |
           |          +----------+--> CANCELLED
           +---------------------+
```
- `QUEUED → CANCELLED`: KITCHEN / WAITER / ADMIN
- `PREPARING → CANCELLED`: WAITER / ADMIN (supervisor authorization after prep starts)
- `READY → CANCELLED`: ADMIN only
- `QUEUED → PREPARING`, `PREPARING → READY`: KITCHEN / ADMIN
- `READY → SERVED`: WAITER / ADMIN
- `SERVED` and `CANCELLED` are terminal.

Any other jump returns `409 INVALID_TRANSITION`; a role that may not perform the step gets `403`.

```
Summary: RECEIVED -> IN_PROGRESS -> PARTIALLY_READY -> READY -> COMPLETED
                                                                    (or CANCELLED)
```
Derivation (cancelled items ignored): `COMPLETED` if every active item is `SERVED`; `READY` if
every active item is `READY`/`SERVED`; `PARTIALLY_READY` if some active item is `READY`/`SERVED`;
`IN_PROGRESS` if some item is `PREPARING`; otherwise `RECEIVED`. No active items left ⇒ `CANCELLED`.
Implemented in `apps/api/src/lib/orderState.ts`.

## Session state machine
```
ACTIVE -> BILL_REQUESTED -> PAYMENT_PENDING -> CLOSED
   ^                                                |
   +-------------- admin reopen (audited) ----------+
```
Ordering is permitted only in `ACTIVE`.

## Key technical risks & mitigations
- **Concurrent submissions / retries**: DB transaction + `SELECT ... FOR UPDATE` on the session
  + unique idempotency key scoped to the session. Verified by concurrent integration tests.
- **Post-closure / stale-QR ordering**: the order endpoint authorizes from the session token,
  then locks that session row `FOR UPDATE` and re-checks `status === 'ACTIVE'`. A stale tab or
  saved QR belonging to a closed session is rejected with `409 SESSION_CLOSED` and can never
  reach a newer session at the same table.
- **Conflicting item updates**: each item transition takes a `SELECT ... FOR UPDATE` lock and
  validates against the central transition table, so two staff racing the same step yield one
  success and one `409` with no duplicate events.
- **Price tampering**: server recomputes totals from catalog; client totals are stripped by Zod.
- **Financial accuracy**: integer minor units, server-side tax/rounding, immutable bill snapshots;
  cancelled line items are excluded from bills.
- **IDOR / cross-table**: the customer's session/table come from the verified token, not from the
  request body; order and session reads are scoped to the token's session; staff endpoints require
  role authorization.
- **Ordering collisions**: order/bill numbers come from Postgres sequences, so concurrent inserts
  cannot produce duplicates.
- **Real-time reliability**: persist-then-notify; reconnect re-syncs from REST.
```
