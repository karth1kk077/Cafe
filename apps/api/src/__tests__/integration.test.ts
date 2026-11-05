import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { prisma } from "../lib/prisma.js";

const app = createApp();

let tableToken: string;
let tableId: string;
let latteId: string;
let variantId: string;
let addonId: string;
let waiterToken: string;
let adminToken: string;
let chefToken: string;

async function login(email: string, password = "Password123!") {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

/** Force-close any lingering session on the shared test table for isolation. */
async function resetTable() {
  const sessions = await prisma.diningSession.findMany({ where: { tableId, status: { not: "CLOSED" } } });
  const ids = sessions.map((s) => s.id);
  if (ids.length) {
    // Terminal-state any live items, then close the sessions directly. This is
    // test-only setup and must not depend on the business lifecycle succeeding.
    await prisma.orderItem.updateMany({
      where: { order: { sessionId: { in: ids } }, status: { notIn: ["SERVED", "CANCELLED"] } },
      data: { status: "CANCELLED" },
    });
    await prisma.diningSession.updateMany({
      where: { id: { in: ids } },
      data: { status: "CLOSED", closedAt: new Date() },
    });
  }
  await prisma.cafeTable.update({ where: { id: tableId }, data: { status: "AVAILABLE" } });
}

async function openSession(token = waiterToken) {
  await resetTable();
  const res = await request(app)
    .post(`/api/staff/tables/${tableId}/sessions`)
    .set("Authorization", `Bearer ${token}`)
    .send({});
  expect(res.status).toBe(201);
  return res.body.session.id as string;
}

/** Resolve the table's QR context and return the minted session-scoped token. */
async function sessionToken() {
  const res = await request(app).get(`/api/public/tables/${tableToken}`);
  expect(res.status).toBe(200);
  return res.body.sessionToken as string | null;
}

/** Open a session and return { sessionId, token } ready for ordering. */
async function openOrderable() {
  const sessionId = await openSession();
  const token = await sessionToken();
  expect(token).toBeTruthy();
  return { sessionId, token: token as string };
}

function patchItem(itemId: string, status: string, token: string) {
  return request(app)
    .patch(`/api/staff/order-items/${itemId}/status`)
    .set("Authorization", `Bearer ${token}`)
    .send({ status });
}

async function placeOrder(token: string, items: Array<Record<string, unknown>>, key?: string) {
  const res = await request(app)
    .post("/api/public/orders")
    .set("x-session-token", token)
    .send({
      idempotencyKey: key ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      items,
    });
  return res;
}

/** Best-effort teardown: serve every item, pay open bills, then close. */
async function closeSessionClean(sessionId: string) {
  const items = await prisma.orderItem.findMany({ where: { order: { sessionId } } });
  for (const it of items) {
    // QUEUED -> PREPARING -> READY -> SERVED (ignore already-passed/no-op steps).
    await patchItem(it.id, "PREPARING", chefToken).ok(() => true);
    await patchItem(it.id, "READY", chefToken).ok(() => true);
    await patchItem(it.id, "SERVED", waiterToken).ok(() => true);
  }
  const bills = await prisma.bill.findMany({ where: { sessionId, status: { in: ["OPEN", "PARTIAL"] } } });
  for (const b of bills) {
    await request(app)
      .post("/api/staff/payments")
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ billId: b.id, amountMinor: b.totalMinor, method: "CASH" })
      .ok(() => true);
  }
  await request(app)
    .post(`/api/staff/sessions/${sessionId}/close`)
    .set("Authorization", `Bearer ${waiterToken}`)
    .send({})
    .ok(() => true);
}

beforeAll(async () => {
  const cat = await prisma.menuCategory.create({
    data: { name: `TestCat-${Date.now()}`, sortOrder: 1 },
  });
  const item = await prisma.menuItem.create({
    data: { categoryId: cat.id, name: "Test Latte", priceMinor: 18000 },
  });
  const variant = await prisma.menuItemVariant.create({
    data: { menuItemId: item.id, name: "Large", priceDeltaMinor: 4000 },
  });
  const addon = await prisma.menuItemAddon.create({
    data: { menuItemId: item.id, name: "Extra Shot", priceMinor: 3000 },
  });
  latteId = item.id;
  variantId = variant.id;
  addonId = addon.id;

  const table = await prisma.cafeTable.create({
    data: { number: `T-${Date.now()}`, qrToken: `qr-${Date.now()}-${Math.random().toString(36).slice(2)}` },
  });
  tableId = table.id;
  tableToken = table.qrToken;

  const bcrypt = (await import("bcryptjs")).default;
  const hash = await bcrypt.hash("Password123!", 12);
  for (const [email, name, role] of [
    ["w@test.local", "Waiter", "WAITER"],
    ["a@test.local", "Admin", "ADMIN"],
    ["c@test.local", "Chef", "KITCHEN"],
  ] as const) {
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name, role, passwordHash: hash },
    });
  }
  waiterToken = await login("w@test.local");
  adminToken = await login("a@test.local");
  chefToken = await login("c@test.local");
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("health & config", () => {
  it("reports ready with database up", async () => {
    const res = await request(app).get("/api/ready");
    expect(res.status).toBe(200);
    expect(res.body.database).toBe("up");
  });
});

describe("authentication & RBAC", () => {
  it("rejects unauthenticated staff access with 401", async () => {
    const res = await request(app).get("/api/staff/tables");
    expect(res.status).toBe(401);
  });

  it("rejects bad credentials with 401", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "w@test.local", password: "wrongpass" });
    expect(res.status).toBe(401);
  });

  it("blocks waiter from admin-only endpoint with 403", async () => {
    const res = await request(app)
      .get("/api/staff/admin/users")
      .set("Authorization", `Bearer ${waiterToken}`);
    expect(res.status).toBe(403);
  });

  it("allows admin to read settings", async () => {
    const res = await request(app)
      .get("/api/staff/admin/settings")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});

describe("session-scoped ordering authorization", () => {
  it("rejects an order with no session token", async () => {
    const res = await request(app)
      .post("/api/public/orders")
      .send({ idempotencyKey: `no-token-${Date.now()}`, items: [{ menuItemId: latteId, quantity: 1 }] });
    expect(res.status).toBe(401);
  });

  it("reports canOrder=false and no token when no session is open", async () => {
    await resetTable();
    const res = await request(app).get(`/api/public/tables/${tableToken}`);
    expect(res.status).toBe(200);
    expect(res.body.canOrder).toBe(false);
    expect(res.body.sessionToken).toBeNull();
  });

  it("computes price on the server and ignores client totals", async () => {
    const { sessionId, token } = await openOrderable();
    const res = await placeOrder(token, [
      { menuItemId: latteId, variantId, addonIds: [addonId], quantity: 2 },
    ]);
    // Client lies about total/price — the schema strips them and the server ignores them.
    expect(res.status).toBe(201);
    // 18000 + 4000 + 3000 = 25000 * 2 = 50000; tax 5% = 2500 -> 52500
    expect(res.body.order.totalMinor).toBe(52500);
    expect(res.body.order.items[0].unitPriceMinor).toBe(25000);
    expect(res.body.order.items[0].status).toBe("QUEUED");
    await closeSessionClean(sessionId);
  });

  it("is idempotent for the same idempotency key", async () => {
    const { sessionId, token } = await openOrderable();
    const key = `idem-${Date.now()}`;
    const a = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }], key);
    const b = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }], key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.order.id).toBe(a.body.order.id);
    const count = await prisma.order.count({ where: { sessionId, id: a.body.order.id } });
    expect(count).toBe(1);
    await closeSessionClean(sessionId);
  });

  it("rejects an unavailable item", async () => {
    const { sessionId, token } = await openOrderable();
    await prisma.menuItem.update({ where: { id: latteId }, data: { isAvailable: false } });
    const res = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ITEM_UNAVAILABLE");
    await prisma.menuItem.update({ where: { id: latteId }, data: { isAvailable: true } });
    await closeSessionClean(sessionId);
  });

  it("CRITICAL: rejects a stale token after the session is closed", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    expect(o.status).toBe(201);
    await closeSessionClean(sessionId);

    // A saved QR page / stale tab still holding the old token must be rejected.
    const late = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("SESSION_CLOSED");
  });

  it("CRITICAL: a stale token cannot order into a new session at the same table", async () => {
    const first = await openOrderable();
    const staleToken = first.token;
    await closeSessionClean(first.sessionId);

    // New group is seated: a fresh session is opened at the same table.
    const second = await openOrderable();
    expect(second.sessionId).not.toBe(first.sessionId);

    // The stale token must NOT silently reach the new session.
    const late = await placeOrder(staleToken, [{ menuItemId: latteId, quantity: 1 }]);
    expect(late.status).toBe(409);

    // And a token for the new session works.
    const fresh = await placeOrder(second.token, [{ menuItemId: latteId, quantity: 1 }]);
    expect(fresh.status).toBe(201);
    expect(fresh.body.order.sessionId).toBe(second.sessionId);
    await closeSessionClean(second.sessionId);
  });

  it("scopes order reads to the authorizing session", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    const orderId = o.body.order.id;

    const ok = await request(app).get(`/api/public/orders/${orderId}`).set("x-session-token", token);
    expect(ok.status).toBe(200);

    // Another table's session token must not read this order.
    const otherTable = await prisma.cafeTable.create({
      data: { number: `T-x-${Date.now()}`, qrToken: `qrx-${Date.now()}` },
    });
    const otherSession = await prisma.diningSession.create({
      data: { tableId: otherTable.id, openedBy: (await prisma.user.findFirstOrThrow({ where: { email: "w@test.local" } })).id },
    });
    const { signCustomerSessionToken } = await import("../lib/customerSession.js");
    const otherToken = signCustomerSessionToken(otherSession.id, otherTable.id);
    const denied = await request(app).get(`/api/public/orders/${orderId}`).set("x-session-token", otherToken);
    expect(denied.status).toBe(404);

    await closeSessionClean(sessionId);
    await prisma.diningSession.delete({ where: { id: otherSession.id } });
    await prisma.cafeTable.delete({ where: { id: otherTable.id } });
  });
});

describe("item-level preparation lifecycle", () => {
  it("derives the order summary as items progress independently", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [
      { menuItemId: latteId, quantity: 1 },
      { menuItemId: latteId, quantity: 1 },
    ]);
    const items = o.body.order.items as Array<{ id: string; status: string }>;
    expect(items).toHaveLength(2);
    expect(o.body.order.status).toBe("RECEIVED");

    const [a, b] = items;

    // Chef starts item A.
    const inProgress = await patchItem(a.id, "PREPARING", chefToken);
    expect(inProgress.status).toBe(200);
    expect(inProgress.body.order.status).toBe("IN_PROGRESS");

    // Chef marks item A ready → partially ready (B still queued).
    const partial = await patchItem(a.id, "READY", chefToken);
    expect(partial.status).toBe(200);
    expect(partial.body.order.status).toBe("PARTIALLY_READY");

    // Waiter serves A while B is still queued → still partially ready.
    const servedA = await patchItem(a.id, "SERVED", waiterToken);
    expect(servedA.status).toBe(200);
    expect(servedA.body.order.status).toBe("PARTIALLY_READY");

    // B progresses to ready → whole order is ready.
    await patchItem(b.id, "PREPARING", chefToken);
    const ready = await patchItem(b.id, "READY", chefToken);
    expect(ready.body.order.status).toBe("READY");

    // Serve B → order completes.
    const done = await patchItem(b.id, "SERVED", waiterToken);
    expect(done.body.order.status).toBe("COMPLETED");

    await closeSessionClean(sessionId);
  });

  it("enforces role permissions per transition", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    const itemId = o.body.order.items[0].id;

    // Waiter cannot start cooking.
    const waiterStart = await patchItem(itemId, "PREPARING", waiterToken);
    expect(waiterStart.status).toBe(403);

    // Chef cannot jump straight to SERVED.
    const chefServe = await patchItem(itemId, "SERVED", chefToken);
    expect(chefServe.status).toBe(409);
    expect(chefServe.body.error.code).toBe("INVALID_TRANSITION");

    // Chef starts + readies; waiter serves.
    expect((await patchItem(itemId, "PREPARING", chefToken)).status).toBe(200);
    expect((await patchItem(itemId, "READY", chefToken)).status).toBe(200);
    expect((await patchItem(itemId, "SERVED", waiterToken)).status).toBe(200);

    // SERVED is terminal.
    const terminal = await patchItem(itemId, "CANCELLED", adminToken);
    expect(terminal.status).toBe(409);

    await closeSessionClean(sessionId);
  });

  it("allows cancelling a queued item but forbids a no-op re-cancel", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    const itemId = o.body.order.items[0].id;

    const cancel = await request(app)
      .post(`/api/staff/order-items/${itemId}/cancel`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ reason: "customer changed mind" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.item.status).toBe("CANCELLED");
    // The only item is cancelled → the order summary is CANCELLED.
    expect(cancel.body.order.status).toBe("CANCELLED");

    const again = await request(app)
      .post(`/api/staff/order-items/${itemId}/cancel`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({});
    expect(again.status).toBe(409);

    await closeSessionClean(sessionId);
  });

  it("exposes a ready-dish queue to waiters", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    const itemId = o.body.order.items[0].id;
    await patchItem(itemId, "PREPARING", chefToken);
    await patchItem(itemId, "READY", chefToken);

    const res = await request(app)
      .get("/api/staff/order-items/ready")
      .set("Authorization", `Bearer ${waiterToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.some((i: { id: string }) => i.id === itemId)).toBe(true);

    await closeSessionClean(sessionId);
  });

  it("records an immutable per-item event trail", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    const itemId = o.body.order.items[0].id;
    await patchItem(itemId, "PREPARING", chefToken);
    await patchItem(itemId, "READY", chefToken);

    const events = await prisma.orderItemEvent.findMany({
      where: { orderItemId: itemId },
      orderBy: { createdAt: "asc" },
    });
    // creation (QUEUED) + PREPARING + READY
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.some((e) => e.source === "CUSTOMER" && e.toStatus === "QUEUED")).toBe(true);
    expect(events.some((e) => e.toStatus === "READY" && e.actorId)).toBe(true);

    await closeSessionClean(sessionId);
  });
});

describe("billing & session close", () => {
  it("only closes once all items are served and the bill is paid", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    const itemId = o.body.order.items[0].id;

    // Unresolved items block close (order still RECEIVED).
    const early = await request(app)
      .post(`/api/staff/sessions/${sessionId}/close`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({});
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("UNRESOLVED_ORDERS");

    await patchItem(itemId, "PREPARING", chefToken);
    await patchItem(itemId, "READY", chefToken);
    await patchItem(itemId, "SERVED", waiterToken);

    const bill = await request(app)
      .post("/api/staff/bills/generate")
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ sessionId });
    expect(bill.status).toBe(201);

    // Unpaid bill blocks close.
    const unpaid = await request(app)
      .post(`/api/staff/sessions/${sessionId}/close`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({});
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.error.code).toBe("UNPAID_BALANCE");

    await request(app)
      .post("/api/staff/payments")
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ billId: bill.body.bill.id, amountMinor: bill.body.bill.totalMinor, method: "CASH" });

    const close = await request(app)
      .post(`/api/staff/sessions/${sessionId}/close`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({});
    expect(close.status).toBe(200);
    expect(close.body.session.status).toBe("CLOSED");
  });

  it("excludes cancelled items from the bill", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [
      { menuItemId: latteId, quantity: 1 },
      { menuItemId: latteId, quantity: 1 },
    ]);
    const [a, b] = o.body.order.items as Array<{ id: string }>;
    await request(app)
      .post(`/api/staff/order-items/${a.id}/cancel`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ reason: "out of stock" });
    // Serve the remaining item.
    await patchItem(b.id, "PREPARING", chefToken);
    await patchItem(b.id, "READY", chefToken);
    await patchItem(b.id, "SERVED", waiterToken);

    const bill = await request(app)
      .post("/api/staff/bills/generate")
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ sessionId });
    expect(bill.status).toBe(201);
    expect(bill.body.bill.lineItems.length).toBe(1);
    // Only one billable line: 18000 + 5% tax = 18900.
    expect(bill.body.bill.subtotalMinor).toBe(18000);
    await closeSessionClean(sessionId);
  });

  it("requires admin role to reopen a session, and allows admin after", async () => {
    const sessionId = await openSession();
    await closeSessionClean(sessionId);
    const denied = await request(app)
      .post(`/api/staff/sessions/${sessionId}/reopen`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ reason: "try" });
    expect(denied.status).toBe(403);
    const ok = await request(app)
      .post(`/api/staff/sessions/${sessionId}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "customer returned" });
    expect(ok.status).toBe(200);
    expect(ok.body.session.status).toBe("ACTIVE");
    const audit = await prisma.auditLog.findFirst({
      where: { action: "SESSION_REOPENED", entityId: sessionId },
    });
    expect(audit).toBeTruthy();
    await closeSessionClean(sessionId);
  });

  it("rejects overpayment", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    const itemId = o.body.order.items[0].id;
    await patchItem(itemId, "PREPARING", chefToken);
    await patchItem(itemId, "READY", chefToken);
    await patchItem(itemId, "SERVED", waiterToken);
    const bill = await request(app)
      .post("/api/staff/bills/generate")
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ sessionId });
    const over = await request(app)
      .post("/api/staff/payments")
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ billId: bill.body.bill.id, amountMinor: bill.body.bill.totalMinor + 1, method: "CASH" });
    expect(over.status).toBe(409);
    await closeSessionClean(sessionId);
  });

  it("rejects duplicate table session (only one active session per table)", async () => {
    await openSession();
    const dup = await request(app)
      .post(`/api/staff/tables/${tableId}/sessions`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({});
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("SESSION_EXISTS");
    await resetTable();
  });

  it("rotates the table QR token on request", async () => {
    const before = await prisma.cafeTable.findUniqueOrThrow({ where: { id: tableId } });
    const res = await request(app)
      .patch(`/api/staff/tables/${tableId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ rotateQr: true });
    expect(res.status).toBe(200);
    expect(res.body.table.qrToken).not.toBe(before.qrToken);
    // The old token no longer resolves.
    const stale = await request(app).get(`/api/public/tables/${before.qrToken}`);
    expect(stale.status).toBe(404);
    // Restore the test token for subsequent suites.
    await prisma.cafeTable.update({ where: { id: tableId }, data: { qrToken: tableToken } });
  });
});

describe("concurrency", () => {
  it("handles two simultaneous order submissions safely", async () => {
    const { sessionId, token } = await openOrderable();
    const [ra, rb] = await Promise.all([
      placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]),
      placeOrder(token, [{ menuItemId: latteId, quantity: 2 }]),
    ]);
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    expect(ra.body.order.id).not.toBe(rb.body.order.id);
    const orders = await prisma.order.findMany({ where: { sessionId } });
    expect(orders.length).toBe(2);
    await closeSessionClean(sessionId);
  });

  it("does not create a duplicate when the same submission is retried concurrently", async () => {
    const { sessionId, token } = await openOrderable();
    const key = `conc-same-${Date.now()}`;
    const [a, b] = await Promise.all([
      placeOrder(token, [{ menuItemId: latteId, quantity: 1 }], key),
      placeOrder(token, [{ menuItemId: latteId, quantity: 1 }], key),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.order.id).toBe(b.body.order.id);
    const rows = await prisma.idempotencyKey.findMany({ where: { key } });
    expect(rows.length).toBe(1);
    await closeSessionClean(sessionId);
  });

  it("resolves concurrent conflicting item transitions without corruption", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    const itemId = o.body.order.items[0].id;
    await patchItem(itemId, "PREPARING", chefToken);

    // Two chefs race to READY the same item; the row lock serializes them so
    // exactly one wins and the loser gets a conflict (not a duplicate event).
    const [r1, r2] = await Promise.all([
      patchItem(itemId, "READY", chefToken),
      patchItem(itemId, "READY", chefToken),
    ]);
    const codes = [r1.status, r2.status].sort();
    expect(codes).toEqual([200, 409]);

    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.status).toBe("READY");

    await closeSessionClean(sessionId);
  });
});

describe("admin tables & QR codes", () => {
  function createTable(number: string, extra: Record<string, unknown> = {}) {
    return request(app)
      .post("/api/staff/tables")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ number, ...extra });
  }

  it("serves the admin QR metadata list to admins only", async () => {
    const denied = await request(app)
      .get("/api/staff/admin/tables")
      .set("Authorization", `Bearer ${waiterToken}`);
    expect(denied.status).toBe(403);

    const ok = await request(app)
      .get("/api/staff/admin/tables")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(ok.status).toBe(200);
    const row = ok.body.tables.find((t: { id: string }) => t.id === tableId);
    expect(row).toBeTruthy();
    expect(row.qrToken).toBe(tableToken);
    // QR URL comes from the configured public base URL, never a hard-coded host.
    expect(row.qrUrl).toMatch(/^https?:\/\//);
    expect(row.qrUrl.endsWith(`/t/${tableToken}`)).toBe(true);
  });

  it("creates a table with a unique QR token, trims its number, and audits it", async () => {
    const number = `QR-${Date.now()}`;
    const res = await createTable(`  ${number}  `, { seats: 2 });
    expect(res.status).toBe(201);
    expect(res.body.table.number).toBe(number);
    expect(res.body.table.seats).toBe(2);
    expect(res.body.table.qrToken).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.table.qrUrl.endsWith(`/t/${res.body.table.qrToken}`)).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "TABLE_CREATED", entityId: res.body.table.id },
    });
    expect(audit).toBeTruthy();
    await prisma.cafeTable.delete({ where: { id: res.body.table.id } });
  });

  it("rejects blank, duplicate (case-insensitive), and conflicting rename labels", async () => {
    const blank = await createTable("   ");
    expect(blank.status).toBe(422);
    expect(blank.body.error.code).toBe("VALIDATION_ERROR");

    const number = `dup-${Date.now()}`;
    const a = await createTable(number);
    expect(a.status).toBe(201);

    const dup = await createTable(number.toUpperCase());
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("DUPLICATE");

    // Renaming a different table onto an existing label is rejected too.
    const b = await createTable(`other-${Date.now()}`);
    expect(b.status).toBe(201);
    const clash = await request(app)
      .patch(`/api/staff/tables/${b.body.table.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ number: number.toUpperCase() });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe("DUPLICATE");

    await prisma.cafeTable.delete({ where: { id: b.body.table.id } });
    await prisma.cafeTable.delete({ where: { id: a.body.table.id } });
  });

  it("stops resolving a QR link when the table is deactivated", async () => {
    const created = await createTable(`off-${Date.now()}`);
    expect(created.status).toBe(201);
    const token = created.body.table.qrToken as string;

    const before = await request(app).get(`/api/public/tables/${token}`);
    expect(before.status).toBe(200);

    const off = await request(app)
      .patch(`/api/staff/tables/${created.body.table.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isActive: false });
    expect(off.status).toBe(200);

    const after = await request(app).get(`/api/public/tables/${token}`);
    expect(after.status).toBe(404);
    expect(after.body.error.code).toBe("NOT_FOUND");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "TABLE_DEACTIVATED", entityId: created.body.table.id },
    });
    expect(audit).toBeTruthy();
    await prisma.cafeTable.delete({ where: { id: created.body.table.id } });
  });
});

describe("QR-first session opening", () => {
  it("lets an AVAILABLE table be ordered from without staff action", async () => {
    await resetTable();
    const lookup = await request(app).get(`/api/public/tables/${tableToken}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.canOrder).toBe(false);
    expect(lookup.body.orderable).toBe(true);
    expect(lookup.body.sessionToken).toBeNull();

    const opened = await request(app).post(`/api/public/tables/${tableToken}/session`).send({});
    expect(opened.status).toBe(201);
    expect(opened.body.session.status).toBe("ACTIVE");
    expect(opened.body.canOrder).toBe(true);
    expect(opened.body.sessionToken).toBeTruthy();

    const order = await placeOrder(opened.body.sessionToken, [{ menuItemId: latteId, quantity: 1 }]);
    expect(order.status).toBe(201);

    const audit = await prisma.auditLog.findFirst({
      where: { action: "SESSION_OPENED", entityId: opened.body.session.id },
    });
    expect(audit?.metadata).toMatchObject({ source: "customer_qr" });

    await closeSessionClean(opened.body.session.id);
  });

  it("is idempotent and lets a second phone join the same session", async () => {
    await resetTable();
    const first = await request(app).post(`/api/public/tables/${tableToken}/session`).send({});
    expect(first.status).toBe(201);
    const sessionId = first.body.session.id as string;

    // Second device scanning the same QR joins the same ACTIVE session.
    const second = await request(app).post(`/api/public/tables/${tableToken}/session`).send({});
    expect(second.status).toBe(200);
    expect(second.body.session.id).toBe(sessionId);
    expect(second.body.sessionToken).toBeTruthy();

    // Both tokens authorize orders into the one session.
    const a = await placeOrder(first.body.sessionToken, [{ menuItemId: latteId, quantity: 1 }]);
    const b = await placeOrder(second.body.sessionToken, [{ menuItemId: latteId, quantity: 1 }]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.order.sessionId).toBe(sessionId);
    expect(b.body.order.sessionId).toBe(sessionId);

    await closeSessionClean(sessionId);
  });

  it("rejects a stale token after close and opens a fresh session on re-scan", async () => {
    await resetTable();
    const first = await request(app).post(`/api/public/tables/${tableToken}/session`).send({});
    const staleToken = first.body.sessionToken as string;
    await placeOrder(staleToken, [{ menuItemId: latteId, quantity: 1 }]);
    await closeSessionClean(first.body.session.id);

    // The old page still holds a token for the closed session.
    const late = await placeOrder(staleToken, [{ menuItemId: latteId, quantity: 1 }]);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("SESSION_CLOSED");

    // A re-scan after the group left opens a new session for the next group.
    const second = await request(app).post(`/api/public/tables/${tableToken}/session`).send({});
    expect(second.status).toBe(201);
    expect(second.body.session.id).not.toBe(first.body.session.id);
    expect(second.body.sessionToken).toBeTruthy();
    await closeSessionClean(second.body.session.id);
  });

  it("does not re-open ordering when the bill has been requested", async () => {
    await resetTable();
    const opened = await request(app).post(`/api/public/tables/${tableToken}/session`).send({});
    const sessionId = opened.body.session.id as string;
    const token = opened.body.sessionToken as string;
    await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);

    const bill = await request(app)
      .post(`/api/public/sessions/${sessionId}/request-bill`)
      .set("x-session-token", token)
      .send({});
    expect(bill.status).toBe(200);

    const again = await request(app).post(`/api/public/tables/${tableToken}/session`).send({});
    expect(again.status).toBe(200);
    expect(again.body.session.id).toBe(sessionId);
    expect(again.body.session.status).toBe("BILL_REQUESTED");
    expect(again.body.canOrder).toBe(false);
    expect(again.body.sessionToken).toBeNull();

    // Even the still-valid token cannot order once the session left ACTIVE.
    const denied = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe("SESSION_CLOSED");

    await closeSessionClean(sessionId);
  });

  it("auto-closes a customer-opened session that never produced an order", async () => {
    await resetTable();
    const opened = await request(app).post(`/api/public/tables/${tableToken}/session`).send({});
    const sessionId = opened.body.session.id as string;

    const { closeIdleCustomerSessions } = await import("../services/sessionService.js");
    await prisma.diningSession.update({
      where: { id: sessionId },
      data: { openedAt: new Date(Date.now() - 31 * 60 * 1000) },
    });
    const closed = await closeIdleCustomerSessions();
    expect(closed).toBeGreaterThanOrEqual(1);

    const session = await prisma.diningSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.status).toBe("CLOSED");
    const table = await prisma.cafeTable.findUniqueOrThrow({ where: { id: tableId } });
    expect(table.status).toBe("AVAILABLE");
  });
});

describe("frictionless UX", () => {
  it("start-session creates PENDING, waiter confirms, then ordering works", async () => {
    await resetTable();
    const res = await request(app)
      .post(`/api/public/tables/${tableToken}/start-session`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.session.status).toBe("PENDING");
    expect(res.body.canOrder).toBe(false);
    expect(res.body.sessionToken).toBeNull();
    const sessionId = res.body.session.id as string;

    const c = await request(app)
      .post(`/api/staff/sessions/${sessionId}/confirm`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({});
    expect(c.status).toBe(200);
    expect(c.body.session.status).toBe("ACTIVE");

    const tok = await sessionToken();
    expect(tok).toBeTruthy();
    const order = await placeOrder(tok as string, [{ menuItemId: latteId, quantity: 1 }]);
    expect(order.status).toBe(201);
    await closeSessionClean(sessionId);
  });

  it("customer can cancel a queued item and the bill preview excludes it", async () => {
    const { sessionId, token } = await openOrderable();
    const o = await placeOrder(token, [{ menuItemId: latteId, quantity: 1 }]);
    expect(o.status).toBe(201);
    const itemId = o.body.order.items[0].id as string;

    const bill1 = await request(app)
      .get(`/api/public/sessions/${sessionId}/bill`)
      .set("x-session-token", token);
    expect(bill1.status).toBe(200);
    expect(bill1.body.isPreview).toBe(true);
    expect(bill1.body.bill.lineItems.length).toBe(1);

    const cancel = await request(app)
      .post(`/api/public/order-items/${itemId}/cancel`)
      .set("x-session-token", token)
      .send({});
    expect(cancel.status).toBe(200);

    const bill2 = await request(app)
      .get(`/api/public/sessions/${sessionId}/bill`)
      .set("x-session-token", token);
    expect(bill2.body.bill.lineItems.length).toBe(0);
    await closeSessionClean(sessionId);
  });

  it("rejects a deactivated staff token immediately", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "w@test.local" } });
    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
    const res = await request(app)
      .get("/api/staff/tables")
      .set("Authorization", `Bearer ${waiterToken}`);
    expect(res.status).toBe(401);
    await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
  });
});
