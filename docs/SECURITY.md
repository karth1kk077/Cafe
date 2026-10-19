# Security Checklist & Notes

## Authentication & sessions
- [x] Passwords hashed with bcrypt (configurable rounds, default 12). Never stored/reversed.
- [x] Login issues a JWT (12h expiry) delivered as an **HttpOnly** cookie plus Bearer token.
- [x] Cookie flags: `HttpOnly` always; `Secure` via `COOKIE_SECURE=true` in production;
      `SameSite` configurable (`lax` default, `none` required for cross-site prod).
- [x] Login brute-force protection via `express-rate-limit` (10/min per IP).
- [x] Logout clears the cookie.

## Authorization
- [x] RBAC enforced **server-side** on every staff route via `authorize(...roles)`.
- [x] Hiding a button is never the enforcement point.
- [x] Customers cannot open/close/reopen sessions or access staff endpoints.
- [x] Reopen is ADMIN-only and written to the audit log.
- [x] Customer ordering uses a signed **session-scoped token** (`{scope:"customer", sessionId,
      tableId}`) sent as `x-session-token`; the server takes the session/table from the token, so a
      client cannot order into an arbitrary session or reach another table.
- [x] Per-item transitions are role-gated and legality-checked against a central transition table;
      post-prep cancellation requires supervisor (WAITER/ADMIN) and `READY` cancellation ADMIN.
- [x] Socket rooms are assigned server-side; a staff token must carry `id`+`role` and a customer
      token must carry `scope:"customer"`+`sessionId` (a customer token is never accepted as staff).

## Input validation & data access
- [x] Zod validation on every request body (orders, login, payments, admin writes).
- [x] Parameterized queries through Prisma ORM (no raw string SQL built from input).
- [x] Raw SQL only via tagged templates (parameterized) for row locks.
- [x] Prices/totals/permissions never trusted from the client.

## Rate limiting & headers
- [x] Global-ish limiting on order submission (configurable) and login.
- [x] `helmet()` security headers.
- [x] CORS locked to `WEB_ORIGIN` with credentials.

## Financial & audit safety
- [x] Integer minor-unit money; no floating point.
- [x] Immutable order/bill snapshots (menu edits don't rewrite history).
- [x] Overpayment and double-pay rejected; bill status transitions guarded.
- [x] Audit logs for privileged actions (session open/close/reopen, payments, order changes).

## Secrets & logging
- [x] All secrets from environment (see `.env.example`); none committed.
- [x] Winston logger redacts `password`, `token`, `secret`, `authorization`, `cookie`, `jwt`.
- [x] Client-facing errors never expose stack traces, DB details, or internals
      (centralized error handler returns generic `INTERNAL_ERROR`).

## QR & IDOR
- [x] QR `qrToken` is 64-char unpredictable hex; identifies a table, not an authorization.
- [x] Table resolved server-side; clients cannot supply an arbitrary table id to order.
- [x] Orders bound to their session/table; cross-table access rejected.
- [x] A token for a **closed** session is rejected with `409 SESSION_CLOSED`, so a stale QR page
      cannot order into the next session at the same table.
- [x] Admin can rotate a table's QR token (`PATCH /staff/tables/:tableId {rotateQr:true}`) to
      invalidate a leaked print.

## Deployment hardening (production)
- [ ] Set `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none` (if cross-site), strong `JWT_SECRET`/`SESSION_SECRET`.
- [ ] Serve behind HTTPS (reverse proxy terminates TLS).
- [ ] Run `npm audit` in CI; triage high/critical advisories.
- [ ] Restrict CORS to the real domain; disable dev defaults.
- [ ] Enable DB backups and test restores.

## Known limitations / future work
- No real payment gateway yet (cash/staff-recorded only); gateway-ready structure in place.
- No CSRF token yet — acceptable because auth uses SameSite cookies + Bearer; add a CSRF
  token if you enable `SameSite=none` cross-site cookie auth.
- Single API instance assumed; scale-out needs the Redis Socket.IO adapter (documented).
