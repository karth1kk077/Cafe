# API Documentation

Base URL: `/api`. Auth via HttpOnly cookie (`cafe_token`) or `Authorization: Bearer <jwt>`.
Errors return `{ "error": { "code": string, "message": string, "details"? } }`.
Money fields are integer minor units (`*Minor`). Validation failures return `422`.

## Auth (`/api/auth`)
| Method | Path | Auth | Body | Notes |
|--------|------|------|------|-------|
| POST | `/login` | public | `{email,password}` | rate-limited; sets cookie; returns `{token,user}` |
| POST | `/logout` | public | — | clears cookie |
| GET | `/me` | any | — | current user |

Roles: `CUSTOMER`, `WAITER`, `KITCHEN`, `ADMIN`.

## Public (`/api/public`) — no auth, order gated by active session
| Method | Path | Notes |
|--------|------|-------|
| GET | `/menu` | categories + items + variants + addons + settings |
| GET | `/tables/:tableCode` | resolve QR token -> table + active session + `canOrder` |
| POST | `/orders` | create order; body `{tableCode, idempotencyKey, items[]}`; 409 `SESSION_CLOSED` if no active session; prices computed server-side |
| GET | `/orders/:orderId` | order status/items |
| GET | `/sessions/:sessionId/orders` | all orders for a session |
| POST | `/sessions/:sessionId/request-bill` | marks session `BILL_REQUESTED` |
| POST | `/sessions/:sessionId/assistance` | create assistance request |

Order item input: `{menuItemId, variantId?, addonIds?, quantity, specialInstructions?}`.
Client-sent prices/totals are ignored.

## Staff (`/api/staff`) — JWT required, role-gated
| Method | Path | Role | Notes |
|--------|------|------|-------|
| GET | `/tables` | any staff | tables + active session summary |
| POST | `/tables` | ADMIN | create table (generates QR token) |
| POST | `/tables/:tableId/sessions` | WAITER/ADMIN | open session (409 if one active) |
| GET | `/sessions/:sessionId` | WAITER/ADMIN | session detail |
| POST | `/sessions/:sessionId/close` | WAITER/ADMIN | 409 `UNPAID_BALANCE` / `UNRESOLVED_ORDERS` |
| POST | `/sessions/:sessionId/reopen` | ADMIN | audited reopen |
| GET | `/orders` | KITCHEN/WAITER/ADMIN | `?status=A,B` filter |
| GET | `/orders/:orderId` | KITCHEN/WAITER/ADMIN | order detail |
| PATCH | `/orders/:orderId/status` | KITCHEN/WAITER/ADMIN | transition; 409 on invalid jump |
| POST | `/bills/generate` | WAITER/ADMIN | `{sessionId}`; immutable snapshot |
| GET | `/bills/:billId` | WAITER/ADMIN | bill + lines + payments |
| POST | `/payments` | WAITER/ADMIN | `{billId,amountMinor,method,reference?}`; 409 overpay/already-paid |
| GET | `/assistance` | WAITER/ADMIN | open requests |
| PATCH | `/assistance/:id` | WAITER/ADMIN | update status |
| GET/POST | `/admin/users` | ADMIN | list / create staff |
| GET | `/admin/audit` | ADMIN | audit logs |
| GET/PATCH | `/admin/settings` | ADMIN | café config |
| POST | `/admin/menu/categories` | ADMIN | create category |
| POST | `/admin/menu/items` | ADMIN | create item |
| PATCH | `/admin/menu/items/:itemId` | ADMIN | update/price/availability |

## Health (`/api`)
| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | liveness |
| GET | `/ready` | readiness (checks DB) |

## Real-time (Socket.IO)
Connect with `auth: { token }` (JWT). Subscribe:
- `subscribe:kitchen` (KITCHEN/ADMIN) -> joins `role:KITCHEN`
- `subscribe:table` (qrToken) (CUSTOMER/WAITER/ADMIN) -> joins `table:<qrToken>`

Events emitted: `order:created`, `order:status`, `bill:requested`, `session:closed`,
`assistance:requested`. Treat events as notifications; re-fetch state over REST.

## Concurrency & idempotency
- `POST /orders` requires a client-generated `idempotencyKey`. Retrying the same key returns
  the same order and never creates a duplicate (DB unique constraint).
- Two different keys on the same active table both succeed (serialized by row lock).
- Session close and payment recording lock the target row to prevent races.
