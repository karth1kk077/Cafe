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

async function openSession(token = waiterToken) {
  // Guarantee isolation: force-close any lingering active session on the test table.
  await prisma.diningSession.updateMany({
    where: { tableId, status: { not: "CLOSED" } },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  await prisma.cafeTable.update({ where: { id: tableId }, data: { status: "AVAILABLE" } });
  const res = await request(app)
    .post(`/api/staff/tables/${tableId}/sessions`)
    .set("Authorization", `Bearer ${token}`)
    .send({});
  expect(res.status).toBe(201);
  return res.body.session.id as string;
}

async function closeSessionClean(sessionId: string) {
  // Best-effort cleanup: mark any open orders served, pay any open bills, then close.
  const orders = await prisma.order.findMany({ where: { sessionId, status: { notIn: ["SERVED", "CANCELLED"] } } });
  for (const o of orders) {
    for (const s of ["ACCEPTED", "PREPARING", "READY", "SERVED"]) {
      await request(app)
        .patch(`/api/staff/orders/${o.id}/status`)
        .set("Authorization", `Bearer ${waiterToken}`)
        .send({ status: s })
        .ok(() => true);
    }
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
  // Seed isolated fixtures in the test DB.
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

  // Ensure staff exist (idempotent).
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

describe("table session + ordering lifecycle", () => {
  it("rejects orders when no active session exists", async () => {
    const res = await request(app).post("/api/public/orders").send({
      tableCode: tableToken,
      idempotencyKey: `no-session-${Date.now()}`,
      items: [{ menuItemId: latteId, quantity: 1 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SESSION_CLOSED");
  });

  it("computes price on the server and ignores client totals", async () => {
    const sessionId = await openSession();
    const res = await request(app).post("/api/public/orders").send({
      tableCode: tableToken,
      idempotencyKey: `price-${Date.now()}`,
      // Client lies about total/price — schema must ignore them.
      totalMinor: 1,
      items: [{ menuItemId: latteId, variantId, addonIds: [addonId], quantity: 2 }],
    });
    expect(res.status).toBe(201);
    // 18000 + 4000 + 3000 = 25000 * 2 = 50000; tax 5% = 2500 -> 52500
    expect(res.body.order.totalMinor).toBe(52500);
    expect(res.body.order.items[0].unitPriceMinor).toBe(25000);
    await closeSessionClean(sessionId);
  });

  it("is idempotent for the same idempotency key", async () => {
    const sessionId = await openSession();
    const key = `idem-${Date.now()}`;
    const payload = {
      tableCode: tableToken,
      idempotencyKey: key,
      items: [{ menuItemId: latteId, quantity: 1 }],
    };
    const a = await request(app).post("/api/public/orders").send(payload);
    const b = await request(app).post("/api/public/orders").send(payload);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.order.id).toBe(a.body.order.id);
    const count = await prisma.order.count({ where: { sessionId, id: a.body.order.id } });
    expect(count).toBe(1);
    await closeSessionClean(sessionId);
  });

  it("rejects an unavailable item", async () => {
    const sessionId = await openSession();
    await prisma.menuItem.update({ where: { id: latteId }, data: { isAvailable: false } });
    const res = await request(app).post("/api/public/orders").send({
      tableCode: tableToken,
      idempotencyKey: `unavail-${Date.now()}`,
      items: [{ menuItemId: latteId, quantity: 1 }],
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ITEM_UNAVAILABLE");
    await prisma.menuItem.update({ where: { id: latteId }, data: { isAvailable: true } });
    await closeSessionClean(sessionId);
  });

  it("enforces allowed order status transitions", async () => {
    const sessionId = await openSession();
    const o = await request(app).post("/api/public/orders").send({
      tableCode: tableToken,
      idempotencyKey: `trans-${Date.now()}`,
      items: [{ menuItemId: latteId, quantity: 1 }],
    });
    const oid = o.body.order.id;
    // invalid jump PENDING -> READY
    const bad = await request(app)
      .patch(`/api/staff/orders/${oid}/status`)
      .set("Authorization", `Bearer ${chefToken}`)
      .send({ status: "READY" });
    expect(bad.status).toBe(409);
    // valid path
    for (const s of ["ACCEPTED", "PREPARING", "READY", "SERVED"]) {
      const r = await request(app)
        .patch(`/api/staff/orders/${oid}/status`)
        .set("Authorization", `Bearer ${chefToken}`)
        .send({ status: s });
      expect(r.status).toBe(200);
    }
    await closeSessionClean(sessionId);
  });

  it("CRITICAL: rejects orders after the session is closed (stale tab / saved QR)", async () => {
    const sessionId = await openSession();
    const o = await request(app).post("/api/public/orders").send({
      tableCode: tableToken,
      idempotencyKey: `pre-${Date.now()}`,
      items: [{ menuItemId: latteId, quantity: 1 }],
    });
    expect(o.status).toBe(201);
    // Serve, bill, pay, close.
    const oid = o.body.order.id;
    for (const s of ["ACCEPTED", "PREPARING", "READY", "SERVED"]) {
      await request(app)
        .patch(`/api/staff/orders/${oid}/status`)
        .set("Authorization", `Bearer ${waiterToken}`)
        .send({ status: s });
    }
    const bill = await request(app)
      .post("/api/staff/bills/generate")
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ sessionId });
    expect(bill.status).toBe(201);
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

    // A stale browser tab / saved QR link tries to order again -> must be rejected.
    const late = await request(app).post("/api/public/orders").send({
      tableCode: tableToken,
      idempotencyKey: `late-${Date.now()}`,
      items: [{ menuItemId: latteId, quantity: 1 }],
    });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("SESSION_CLOSED");

    // canOrder reflects closed state for the saved QR URL.
    const t = await request(app).get(`/api/public/tables/${tableToken}`);
    expect(t.body.canOrder).toBe(false);
  });

  it("requires admin role to reopen a session, and allows admin after", async () => {
    const sessionId = await openSession();
    await closeSessionClean(sessionId);
    // Waiter cannot reopen.
    const denied = await request(app)
      .post(`/api/staff/sessions/${sessionId}/reopen`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ reason: "try" });
    expect(denied.status).toBe(403);
    // Admin can.
    const ok = await request(app)
      .post(`/api/staff/sessions/${sessionId}/reopen`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "customer returned" });
    expect(ok.status).toBe(200);
    expect(ok.body.session.status).toBe("ACTIVE");
    // Reopen writes an audit entry.
    const audit = await prisma.auditLog.findFirst({
      where: { action: "SESSION_REOPENED", entityId: sessionId },
    });
    expect(audit).toBeTruthy();
    await closeSessionClean(sessionId);
  });

  it("cannot close a session while an unpaid bill exists", async () => {
    const sessionId = await openSession();
    const o = await request(app).post("/api/public/orders").send({
      tableCode: tableToken,
      idempotencyKey: `unpaid-${Date.now()}`,
      items: [{ menuItemId: latteId, quantity: 1 }],
    });
    const oid = o.body.order.id;
    for (const s of ["ACCEPTED", "PREPARING", "READY", "SERVED"]) {
      await request(app)
        .patch(`/api/staff/orders/${oid}/status`)
        .set("Authorization", `Bearer ${waiterToken}`)
        .send({ status: s });
    }
    const bill = await request(app)
      .post("/api/staff/bills/generate")
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ sessionId });
    // Bill is OPEN, unpaid -> close must fail.
    const close = await request(app)
      .post(`/api/staff/sessions/${sessionId}/close`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({});
    expect(close.status).toBe(409);
    expect(close.body.error.code).toBe("UNPAID_BALANCE");
    // Pay then close succeeds.
    await request(app)
      .post("/api/staff/payments")
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({ billId: bill.body.bill.id, amountMinor: bill.body.bill.totalMinor, method: "CASH" });
    const close2 = await request(app)
      .post(`/api/staff/sessions/${sessionId}/close`)
      .set("Authorization", `Bearer ${waiterToken}`)
      .send({});
    expect(close2.status).toBe(200);
  });

  it("rejects overpayment", async () => {
    const sessionId = await openSession();
    const o = await request(app).post("/api/public/orders").send({
      tableCode: tableToken,
      idempotencyKey: `over-${Date.now()}`,
      items: [{ menuItemId: latteId, quantity: 1 }],
    });
    const oid = o.body.order.id;
    for (const s of ["ACCEPTED", "PREPARING", "READY", "SERVED"]) {
      await request(app)
        .patch(`/api/staff/orders/${oid}/status`)
        .set("Authorization", `Bearer ${waiterToken}`)
        .send({ status: s });
    }
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
  });
});

describe("concurrency", () => {
  it("handles two simultaneous order submissions safely", async () => {
    const sessionId = await openSession();
    const keyA = `conc-a-${Date.now()}`;
    const keyB = `conc-b-${Date.now()}`;
    const [ra, rb] = await Promise.all([
      request(app).post("/api/public/orders").send({
        tableCode: tableToken,
        idempotencyKey: keyA,
        items: [{ menuItemId: latteId, quantity: 1 }],
      }),
      request(app).post("/api/public/orders").send({
        tableCode: tableToken,
        idempotencyKey: keyB,
        items: [{ menuItemId: latteId, quantity: 2 }],
      }),
    ]);
    expect(ra.status).toBe(201);
    expect(rb.status).toBe(201);
    expect(ra.body.order.id).not.toBe(rb.body.order.id);
    // Both persisted distinctly.
    const orders = await prisma.order.findMany({ where: { sessionId } });
    expect(orders.length).toBe(2);
    await closeSessionClean(sessionId);
  });

  it("does not create a duplicate when the same submission is retried concurrently", async () => {
    const sessionId = await openSession();
    const key = `conc-same-${Date.now()}`;
    const payload = {
      tableCode: tableToken,
      idempotencyKey: key,
      items: [{ menuItemId: latteId, quantity: 1 }],
    };
    // Fire the identical request twice at once; unique key must prevent two rows.
    const [a, b] = await Promise.all([
      request(app).post("/api/public/orders").send(payload),
      request(app).post("/api/public/orders").send(payload),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.order.id).toBe(b.body.order.id);
    const rows = await prisma.idempotencyKey.findMany({ where: { key } });
    expect(rows.length).toBe(1);
    await closeSessionClean(sessionId);
  });
});

describe("cross-table access (IDOR)", () => {
  it("rejects ordering on a table using another table's code path", async () => {
    // Create a second table; ordering on table A must not affect table B.
    const t2 = await prisma.cafeTable.create({
      data: { number: `T2-${Date.now()}`, qrToken: `qr2-${Date.now()}` },
    });
    const sessionId = await openSession();
    // A valid order on table A.
    const o = await request(app).post("/api/public/orders").send({
      tableCode: tableToken,
      idempotencyKey: `idor-${Date.now()}`,
      items: [{ menuItemId: latteId, quantity: 1 }],
    });
    expect(o.status).toBe(201);
    expect(o.body.order.tableId).toBe(tableId);
    expect(o.body.order.tableId).not.toBe(t2.id);
    await closeSessionClean(sessionId);
  });
});
