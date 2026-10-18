# Manual Acceptance Testing Checklist

Run against a seeded environment (`npm run dev:api` + `npm run dev:web`).
Seeded staff (password `Password123!`): admin@cafe.local, waiter@cafe.local, chef@cafe.local.

## Customer QR flow
- [ ] Scan/open `/t/<qrToken>` → mobile menu loads with categories, prices, dietary/allergen tags.
- [ ] Table with no session shows "ask a waiter to open your table" and cannot order.
- [ ] Customize an item (variant + add-on + notes) → cart subtotal is correct.
- [ ] Place order → appears in My Orders with status; kitchen notified in real time.
- [ ] Request assistance → waiter sees the notification.
- [ ] Request bill → session goes to bill-requested; ordering disabled.

## Kitchen (chef phone)
- [ ] Log in as chef → new orders appear live with table, order #, time, items, notes.
- [ ] Audible/visual alert on new order (where browser allows).
- [ ] Accept → Preparing → Ready transitions work; invalid jumps blocked.
- [ ] Reconnect after dropping connection → outstanding orders re-sync.

## Waiter dashboard
- [ ] Table grid shows status colors (available/occupied/bill requested).
- [ ] Open session for an available table.
- [ ] See ready-to-serve and bill-request notifications.
- [ ] Generate bill, record full cash payment → bill PAID.
- [ ] Close session → succeeds only after orders served + bill paid.
- [ ] Attempt to close with unpaid bill → blocked with a clear message.

## Admin
- [ ] Create a staff account; log in as that account.
- [ ] Create menu item / category; set availability.
- [ ] View audit log (session open/close, payments, order changes present).
- [ ] Edit café settings (name/tax) reflected in customer menu totals.

## Critical security/correctness
- [ ] With a session closed, reuse the old QR link / open tab → ordering rejected (server-side).
- [ ] Try to submit an order with a fake client price → server price wins.
- [ ] Retry an order with the same idempotency key → no duplicate order.
- [ ] Log in as waiter → admin-only pages/API are blocked (403).
- [ ] Two tables order simultaneously → orders stay separated by table.

## Billing accuracy
- [ ] Bill totals match the sum of served (non-cancelled) items including tax/rounding.
- [ ] Recording a partial payment leaves the bill PARTIAL; overpayment is rejected.
