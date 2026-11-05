import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const suffix = Date.now().toString(36);
const tableNumber = `E2E-${suffix}`;
const itemName = `E2E Espresso ${suffix}`;

let tableId: string;
let tableToken: string;
let categoryId: string;
let menuItemId: string;

test.beforeAll(async () => {
  const category = await prisma.menuCategory.create({
    data: { name: `E2E Category ${suffix}`, sortOrder: 999 },
  });
  categoryId = category.id;
  const item = await prisma.menuItem.create({
    data: {
      categoryId: category.id,
      name: itemName,
      description: "Created by the Playwright happy-path test",
      priceMinor: 12000,
      isAvailable: true,
    },
  });
  menuItemId = item.id;

  const token = `e2e-${suffix}-${Math.random().toString(36).slice(2)}`;
  const table = await prisma.cafeTable.create({
    data: { number: tableNumber, qrToken: token, seats: 2 },
  });
  tableId = table.id;
  tableToken = token;
});

test.afterAll(async () => {
  try {
    const sessions = await prisma.diningSession.findMany({
      where: { tableId },
      select: { id: true },
    });
    const sessionIds = sessions.map((s) => s.id);
    const bills = await prisma.bill.findMany({ where: { tableId }, select: { id: true } });
    const billIds = bills.map((b) => b.id);
    await prisma.payment.deleteMany({ where: { billId: { in: billIds } } });
    await prisma.billLineItem.deleteMany({ where: { billId: { in: billIds } } });
    await prisma.bill.deleteMany({ where: { tableId } });
    const orders = await prisma.order.findMany({ where: { tableId }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);
    await prisma.orderItemEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderItemAddon.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
    await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { tableId } });
    await prisma.idempotencyKey.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.assistanceRequest.deleteMany({ where: { tableId } });
    await prisma.diningSession.deleteMany({ where: { tableId } });
    await prisma.cafeTable.delete({ where: { id: tableId } });
    await prisma.menuItem.delete({ where: { id: menuItemId } });
    await prisma.menuCategory.delete({ where: { id: categoryId } });
  } finally {
    await prisma.$disconnect();
  }
});

test("customer goes from QR to confirmed table to placed order at 360px", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/t/${tableToken}`);

  await expect(page.getByText(`Table ${tableNumber}`)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: "Start ordering" }).click();
  await expect(page.getByText(/Waiting for a waiter to confirm/i)).toBeVisible();

  // Staff side of the handshake, exactly as the waiter screen performs it.
  const login = await request.post("/api/auth/login", {
    data: { email: "waiter@cafe.local", password: "Password123!" },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = await login.json();

  const session = await prisma.diningSession.findFirstOrThrow({
    where: { tableId, status: "PENDING" },
  });
  const confirm = await request.post(`/api/staff/sessions/${session.id}/confirm`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {},
  });
  expect(confirm.ok()).toBeTruthy();

  // The waiting screen polls; once confirmed, ordering controls appear.
  await expect(page.getByText(/Waiting for a waiter to confirm/i)).toBeHidden({ timeout: 15_000 });

  await page.getByPlaceholder(/Search menu/i).fill(itemName);
  await expect(page.getByRole("heading", { name: itemName })).toBeVisible();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: /Place Order/i }).click();
  await expect(page.getByText(/Order placed/i)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("link", { name: /My Orders/i }).click();
  await expect(page.getByText(itemName).first()).toBeVisible();

  const ordersOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(ordersOverflow).toBeLessThanOrEqual(1);
});
