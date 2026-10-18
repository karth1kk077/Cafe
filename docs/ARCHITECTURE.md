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
  S -->|room: KITCHEN/WAITER/ADMIN/table| W
```

## Real-time architecture
- Socket connections are authenticated with the same JWT as REST.
- Staff join role rooms (`role:KITCHEN`, `role:WAITER`, `role:ADMIN`). Customers join only
  their `table:<qrToken>` room via an authorized subscribe handler.
- Events are **notifications, not source of truth**. State is persisted in PostgreSQL first;
  clients re-fetch over REST after any event and on reconnect.
- Events: `order:created`, `order:status`, `bill:requested`, `session:closed`,
  `assistance:requested`.
- Scaling beyond one instance: swap the default in-memory Socket.IO adapter for the Redis
  adapter (`@socket.io/redis-adapter`) and put the API behind a load balancer with sticky
  sessions or Redis-backed pub/sub. Postgres remains the durable store.

## Critical business flow (order lifecycle)
1. QR resolves a table by unpredictable `qrToken` — the QR is an identifier, not a credential.
2. Customer browses menu; cart is client-side only and grants no authorization.
3. On submit, the server (in a transaction):
   - resolves the table by token,
   - locks the open session row `FOR UPDATE`,
   - rejects unless the session is `ACTIVE` (post-closure rule),
   - replays idempotency key if present,
   - recomputes all prices/totals from the catalog (client prices ignored),
   - snapshots item names/prices/modifiers onto the order,
   - writes the order + status history + idempotency record.
4. Kitchen receives `order:created`, updates status through the allowed transition graph.
5. Waiter generates an immutable bill snapshot, records payment, then closes the session.
6. After closure the session can never accept orders again unless an admin reopens it (audited).

## Order state machine
```
PENDING -> ACCEPTED -> PREPARING -> READY -> SERVED
   |          |           |
   +----------+-----------+--> CANCELLED
```
Only these transitions are permitted; any other jump returns 409.

## Session state machine
```
ACTIVE -> BILL_REQUESTED -> PAYMENT_PENDING -> CLOSED
   ^                                                |
   +-------------- admin reopen (audited) ----------+
```
Ordering is permitted only in `ACTIVE`.

## Key technical risks & mitigations
- **Concurrent submissions / retries**: DB transaction + `SELECT ... FOR UPDATE` on the session
  + unique idempotency key. Verified by concurrent integration tests.
- **Post-closure ordering**: enforced inside the transaction by checking `status === 'ACTIVE'`
  after locking the row; a stale browser or saved QR cannot bypass it.
- **Price tampering**: server recomputes totals from catalog; client totals are stripped by Zod.
- **Financial accuracy**: integer minor units, server-side tax/rounding, immutable bill snapshots.
- **IDOR / cross-table**: table resolved server-side from token; order endpoints never trust a
  client table id; staff endpoints require role authorization.
- **Real-time reliability**: persist-then-notify; reconnect re-syncs from REST.
```
