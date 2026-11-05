# API Documentation

Base URL: `/api`. Staff auth via HttpOnly cookie (`cafe_token`) or `Authorization: Bearer <jwt>`.
Errors return `{ "error": { "code": string, "message": string, "details"? } }`.
Money fields are integer minor units (`*Minor`). Validation failures return `422`.

## Auth (`/api/auth`)
| Method | Path | Auth | Body | Notes |
|--------|------|------|------|-------|
| POST | `/login` | public | `{email,password}` | rate-limited; sets cookie; returns `{token,user}` |
| POST | `/logout` | public | — | clears cookie |
| GET | `/me` | any | — | current user |

Roles: `CUSTOMER`, `WAITER`, `KITCHEN`, `ADMIN`.

## Customer session authorization

Customers are account-less. `GET /public/tables/:tableCode` resolves the QR token and, when a
session is orderable, mints a **session-scoped token** (signed JWT, claim `{scope:"customer",
sessionId, tableId}`). The SPA stores it and sends it as the `x-session-token` header on every
subsequent customer call. The server never trusts a client-supplied session/table id: it uses the
token's `sessionId`, and rejects requests whose token session does not match the resource. A page
holding a token for a **closed** session is rejected with `409 SESSION_CLOSED`, so a stale tab or
saved QR cannot silently order into the next session at the same table.

## Table QR codes

Each `CafeTable` carries a unique, unpredictable `qrToken` (64 hex chars, generated server-side at
creation, rotatable by an admin). The QR encodes `{PUBLIC_APP_BASE_URL}/t/<qrToken>` — a configured
public base URL (`PUBLIC_APP_BASE_URL`, defaulting to `WEB_ORIGIN`), never a hard-coded host, and
never internal IDs, status, or any authorization claim. Admin table endpoints return a ready-made
`qrUrl`; the web app renders the QR image client-side from it (`qrcode`), so no image files are
stored. The token is stable for the life of the table unless rotated, and rotation invalidates the
old link (the physical code must be reprinted). The QR identifies the table only: ordering
eligibility is re-checked server-side on every lookup and every order submission.

## Public (`/api/public`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/menu` | public | categories + items + variants + addons + settings |
| GET | `/tables/:tableCode` | public | resolve QR token -> `{table, session, canOrder, sessionToken}`; a `PENDING` session is returned with `canOrder:false` and no token; rate-limited (`RATE_LIMIT_MAX`); payload carries no internal IDs (404 for unknown/inactive tokens) |
| POST | `/tables/:tableCode/start-session` | public | customer "start ordering"; creates (or returns) a `PENDING` session for a waiter to confirm; never mints a token while pending; audited `SESSION_REQUESTED` |
| POST | `/orders` | `x-session-token` | create order; body `{idempotencyKey, items[]}` (no table/session/client prices); 409 `SESSION_CLOSED`; prices computed server-side |
| GET | `/sessions/:sessionId/bill` | `x-session-token` | bill view: snapshot when generated, otherwise a preview from non-cancelled items; returns `{bill, paidMinor, dueMinor, isPreview, settings:{cafeName,currency,upiId}}` |
| POST | `/order-items/:itemId/cancel` | `x-session-token` | customer cancels their own `QUEUED` item `{reason?}`; later states are rejected |
| GET | `/orders/:orderId` | `x-session-token` | order + per-item status (404 if not in the token's session) |
| GET | `/sessions/:sessionId/orders` | `x-session-token` | all orders for the authorized session |
| POST | `/sessions/:sessionId/request-bill` | `x-session-token` | marks session `BILL_REQUESTED` |
| POST | `/sessions/:sessionId/assistance` | `x-session-token` | create assistance request |

Order item input: `{menuItemId, variantId?, addonIds?, quantity, specialInstructions?}`.
Client-sent prices/totals are ignored.

## Staff (`/api/staff`) — JWT required, role-gated
| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/tables` | any staff | tables + active session + open order items |
| POST | `/tables` | ADMIN | create table; trimmed number, seats optional; 422 validation, 409 `DUPLICATE` (case-insensitive); generates QR token, returns `{table, qrUrl}`, audited `TABLE_CREATED` |
| PATCH | `/tables/:tableId` | ADMIN | update number/seats/isActive (same validation); `{rotateQr:true}` rotates the QR token; returns `qrUrl`; audited (`TABLE_UPDATED`/`TABLE_DEACTIVATED`/`TABLE_ACTIVATED`/`TABLE_QR_ROTATED`) |
| GET | `/admin/tables` | ADMIN | table list with QR metadata: `qrToken`, `qrUrl`, `activeSession`, timestamps |
| POST | `/tables/:tableId/sessions` | WAITER/ADMIN | open session directly (409 if one active) |
| POST | `/sessions/:sessionId/confirm` | WAITER/ADMIN | confirm a customer-requested `PENDING` session -> `ACTIVE`; no-op if already active; audited `SESSION_CONFIRMED` |
| GET | `/sessions/:sessionId` | WAITER/ADMIN | session detail |
| POST | `/sessions/:sessionId/close` | WAITER/ADMIN | 409 `UNPAID_BALANCE` / `UNRESOLVED_ORDERS` |
| POST | `/sessions/:sessionId/reopen` | ADMIN | audited reopen |
| GET | `/orders` | KITCHEN/WAITER/ADMIN | `?status=A,B` filter (derived summary statuses) |
| GET | `/orders/:orderId` | KITCHEN/WAITER/ADMIN | order detail incl. item statuses + history |
| GET | `/order-items/ready` | WAITER/ADMIN | ready-dish pickup queue (oldest first) |
| PATCH | `/order-items/:itemId/status` | KITCHEN/WAITER/ADMIN | transition one item; role + legality enforced; 409 `INVALID_TRANSITION` |
| POST | `/order-items/:itemId/cancel` | KITCHEN/WAITER/ADMIN | cancel one item `{reason?}`; post-prep cancel requires supervisor (WAITER/ADMIN) |
| POST | `/bills/generate` | WAITER/ADMIN | `{sessionId}`; immutable snapshot; cancelled items excluded |
| GET | `/bills/:billId` | WAITER/ADMIN | bill + lines + payments |
| POST | `/payments` | WAITER/ADMIN | `{billId,amountMinor,method,reference?}`; 409 overpay/already-paid |
| GET | `/assistance` | WAITER/ADMIN | open requests |
| PATCH | `/assistance/:id` | WAITER/ADMIN | update status |
| GET/POST | `/admin/users` | ADMIN | list / create staff |
| PATCH | `/admin/users/:userId` | ADMIN | update name/role/`isActive`/password; cannot deactivate yourself; audited |
| GET | `/admin/audit` | ADMIN | audit logs |
| GET/PATCH | `/admin/settings` | ADMIN | café config incl. `upiId` (used for the UPI deep link) |
| GET | `/admin/menu` | ADMIN | categories + items including unavailable ("86'd") ones |
| POST | `/admin/menu/categories` | ADMIN | create category |
| PATCH | `/admin/menu/categories/:categoryId` | ADMIN | rename/sort/hide category |
| POST | `/admin/menu/items` | ADMIN | create item |
| PATCH | `/admin/menu/items/:itemId` | ADMIN | update name/price/availability/category/tags |

## Item lifecycle (per line item)

`QUEUED → PREPARING → READY → SERVED`, with `CANCELLED` allowed from `QUEUED` (the owning
customer, KITCHEN/WAITER/ADMIN)
and `PREPARING` (WAITER/ADMIN), and from `READY` (ADMIN only). `SERVED`/`CANCELLED` are terminal.
`PATCH /order-items/:itemId/status` rejects any other jump with `409 INVALID_TRANSITION`; a role
that may not perform the step gets `403`. Each accepted change appends an immutable
`OrderItemEvent` and an `AuditLog`, and recomputes the order's derived summary.

## Order summary (derived, read-only)

`RECEIVED → IN_PROGRESS → PARTIALLY_READY → READY → COMPLETED`, plus `CANCELLED`. It is recomputed
from the line items on every transition (see `apps/api/src/lib/orderState.ts`) and is never set
directly by a client. `COMPLETED` = every active item served; `READY` = every active item
ready-or-served; `PARTIALLY_READY` = some active item ready/served; `IN_PROGRESS` = some item
preparing; otherwise `RECEIVED`. Cancelled items are ignored.

## Health (`/api`)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | liveness |
| GET | `/ready` | readiness (checks DB) |

## Real-time (Socket.IO)

Connect with `auth: { token }`, where `token` is either a staff JWT or a customer session token.
Rooms are assigned **server-side**; clients cannot name their own room:
- Staff join `role:<ROLE>`.
- Customers join `session:<sessionId>` (from their verified token).

Events emitted (notifications — always re-fetch state over REST):
`order.created`, `order.updated`, `order_item.status_changed`, `order_item.ready`,
`order_item.served`, `bill.requested`, `session.closed`, `session.reopened`,
`assistance_request.created`, `menu.updated` (broadcast so "86'd" items disappear for
customers and staff immediately).

Staff sockets are revalidated against the database on connect, so deactivated accounts and role
changes take effect immediately (matching HTTP auth).

## Concurrency & idempotency
- `POST /orders` requires a client-generated `idempotencyKey`; retrying the same key on the same
  session returns the same order and never creates a duplicate (DB unique constraint), while reuse
  for a different session is rejected (`409 IDEMPOTENCY_CONFLICT`).
- Order/bill numbers come from Postgres sequences, so concurrent submissions cannot collide.
- Item transitions take a `SELECT ... FOR UPDATE` row lock: two staff racing the same transition
  yield exactly one success and one `409` (no duplicate events).
- Session close and payment recording lock the target row to prevent races.
