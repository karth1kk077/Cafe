# Manual Acceptance Testing Checklist

Run against a seeded environment (`npm run dev:api` + `npm run dev:web`).
Seeded staff (password `Password123!`): admin@cafe.local, waiter@cafe.local, chef@cafe.local.

## Customer QR flow
- [ ] Scan/open `/t/<qrToken>` → mobile menu loads with categories, prices, dietary/allergen tags.
- [ ] Table with no session shows "ask a waiter to open your table" and cannot order.
- [ ] Customize an item (variant + add-on + notes) → cart subtotal is correct.
- [ ] Place order → appears in My Orders with a per-dish status; kitchen notified in real time.
- [ ] Watch a multi-dish order: dishes show `Ordered → Being prepared → Ready → Served`
      independently, and the order badge moves `RECEIVED → IN_PROGRESS → PARTIALLY_READY → READY
      → COMPLETED`.
- [ ] Request assistance → waiter sees the notification.
- [ ] Request bill → session goes to bill-requested; ordering disabled.

## Kitchen (chef phone)
- [ ] Log in as chef → new orders appear live with table, order #, time, items, notes.
- [ ] Audible/visual alert on new order (where browser allows).
- [ ] Each dish advances independently: Start (→ PREPARING) then Mark ready (→ READY).
- [ ] Chef cannot mark a dish Served (waiter-only) and cannot jump Queued → Ready.
- [ ] Reconnect after dropping connection → outstanding orders re-sync.

## Waiter dashboard
- [ ] Table grid shows status colors (available/occupied/bill requested).
- [ ] Open session for an available table.
- [ ] "Ready to serve" queue lists each ready dish grouped by table/order with time-ready.
- [ ] Mark an individual dish Served; the order completes only when all dishes are served.
- [ ] See ready-to-serve and bill-request notifications.
- [ ] Generate bill, record full cash payment → bill PAID.
- [ ] Close session → succeeds only after all dishes served + bill paid.
- [ ] Attempt to close with unpaid bill → blocked with a clear message.
- [ ] Cancel a Queued/Preparing dish (with reason) → it is excluded from the bill.

## Admin
- [ ] Create a staff account; log in as that account.
- [ ] Create menu item / category; set availability.
- [ ] View audit log (session open/close, payments, order changes present).
- [ ] Edit café settings (name/tax) reflected in customer menu totals.
- [ ] Rotate a table's QR token → the old printed QR no longer resolves.

## Admin → Tables & QR Codes
- [ ] Open Admin → "Tables & QR" → table list loads (number, seats, status, active/inactive, QR ready).
- [ ] Add a table → QR preview opens automatically with table label + destination URL.
- [ ] Add a duplicate number in different case (e.g. `t1` vs `T1`) → rejected with a clear message;
      blank/whitespace-only numbers are rejected too.
- [ ] Edit a table's number/seats → list updates; renaming onto an existing number is rejected.
- [ ] Search + status filter narrow the list; empty state offers Add table; API failure shows Retry.
- [ ] Copy link → clipboard holds `<base>/t/<token>`; paste matches the printed destination URL.
- [ ] **Test scan** opens the table's `qrUrl` in a new tab and resolves to that table's menu.
- [ ] Download PNG → file opens/scans; Download SVG → valid vector, also scans (error correction level M).
- [ ] Print → sheet shows café name, table number, and QR only (no admin nav/rows); scan the printed
      sheet with a phone camera → opens the customer menu for that table with no app install.
- [ ] **Print active QR codes** generates one A4 print sheet with 6 active-table cards per page
      (respects the current search/status filter). Each card has the table label and a scannable QR.
- [ ] If QR URLs resolve to `localhost`/`127.0.0.1` or use `http:`, the panel shows a warning to set
      `PUBLIC_APP_BASE_URL` to a public HTTPS/LAN address before printing.
- [ ] Deactivate a table (confirm dialog) → its QR link returns "not found"; reactivate restores it.
- [ ] Rotate QR (confirm dialog warns about reprint) → old printed QR stops resolving, the new QR
      preview opens, and the print dialog is offered for the replacement stand.
- [ ] Confirm the QR URL honours `PUBLIC_APP_BASE_URL` when set (not the hard-coded dev host).

## Critical security/correctness
- [ ] With a session closed, reuse the old QR link / open tab (stale session token) → ordering
      rejected server-side with `SESSION_CLOSED`.
- [ ] Start a new session at the same table, then use the previous session's saved page → rejected;
      it cannot order into the new session.
- [ ] Try to submit an order with a fake client price → server price wins.
- [ ] Retry an order with the same idempotency key → no duplicate order.
- [ ] Log in as waiter → admin-only pages/API are blocked (403).
- [ ] Two tables order simultaneously → orders stay separated by table.

## Billing accuracy
- [ ] Bill totals match the sum of non-cancelled items including tax/rounding.
- [ ] Cancelled dishes are excluded from the bill.
- [ ] Recording a partial payment leaves the bill PARTIAL; overpayment is rejected.

## Mobile layout (~360 px width, or a real phone)
Run every surface below in a narrow browser window or on a phone.
- [ ] No page scrolls horizontally at any point.
- [ ] Pinch zoom still works (the viewport no longer locks scaling).
- [ ] Customer menu (QR-first): a bare scan shows "Browse freely — your table opens automatically
      when you place your first order" and does not occupy the table. Category scroll-spy tabs stick
      under the header; search filters items; dishes with no variants/add-ons add with one tap; others
      open the item sheet. The cart sheet slides up, persists across reloads, and the place-order
      button is reachable above the home indicator.
- [ ] Order tracking: the stepper reflects per-dish status; haptic/success toast fires when a dish
      becomes ready; the bottom action bar sits above the home indicator and never covers the last card.
- [ ] Kitchen: filter chips are comfortable to tap; "Start preparing"/"Mark ready" buttons are not
      cramped; the filter bar never slides under the header.
- [ ] Waiter: table grid is usable on a phone; the table sheet reaches the bottom edge cleanly;
      Served/Cancel buttons in the sheet are tappable.
- [ ] Admin: tab bar (Staff/Tables & QR/Menu/Audit/Settings) scrolls sideways if needed and sticks
      under the header; Tables & QR row buttons (View QR/Test scan/Copy/Edit/Deactivate) are comfortable.
- [ ] Any form (login, admin, customizer notes): focusing a text field does NOT auto-zoom the page
      on iOS Safari.
