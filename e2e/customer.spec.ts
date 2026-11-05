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

test("customer scans QR, orders in one tap, and tracks the order at 360px", async ({ page, request, browser }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/t/${tableToken}`);

  await expect(page.getByText(`Table ${tableNumber}`)).toBeVisible();
  // A bare scan must not occupy the table: ordering opens on the first order.
  await expect(page.getByText(/Browse freely/i)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // One-tap add for a dish with no variants or add-ons.
  await page.getByPlaceholder(/Search the menu/i).fill(itemName);
  await expect(page.getByRole("heading", { name: itemName })).toBeVisible();
  await page.getByRole("button", { name: /Add .* to order/i }).first().click();
  await expect(page.getByRole("button", { name: /Review order/i })).toBeVisible();

  // Cart survives a reload (phone browsers suspend tabs aggressively).
  await page.reload();
  await expect(page.getByRole("button", { name: /Review order/i })).toBeVisible();

  await page.getByRole("button", { name: /Review order/i }).click();
  await expect(page.getByRole("dialog", { name: "Your order" })).toBeVisible();
  await page.getByRole("button", { name: /Place order/i }).click();
  await expect(page.getByText(/Order placed/i)).toBeVisible({ timeout: 15_000 });

  // The session was opened lazily and the order is attached to it.
  const session = await prisma.diningSession.findFirstOrThrow({
    where: { tableId, status: "ACTIVE" },
    include: { orders: true },
  });
  expect(session.orders).toHaveLength(1);

  // A second phone at the same table joins the same session.
  const join = await request.get(`/api/public/tables/${tableToken}`);
  expect(join.ok()).toBeTruthy();
  const joinBody = await join.json();
  expect(joinBody.canOrder).toBe(true);
  expect(joinBody.session.status).toBe("ACTIVE");
  expect(joinBody.sessionToken).toBeTruthy();

  const secondDevice = await browser.newContext();
  const secondPage = await secondDevice.newPage();
  await secondPage.goto(`/t/${tableToken}`);
  await expect(secondPage.getByText(`Table ${tableNumber}`)).toBeVisible();
  await expect(secondPage.getByPlaceholder(/Search the menu/i)).toBeVisible();
  await secondDevice.close();

  // Tracking screen shows the live stepper and the running bill.
  await page.getByRole("link", { name: /Orders & bill/i }).click();
  await expect(page).toHaveURL(new RegExp(`/t/${tableToken}/orders`));
  await expect(page.getByRole("heading", { name: "Your order" })).toBeVisible();
  await expect(page.getByText(itemName).first()).toBeVisible();
  await expect(page.getByText("Ordered", { exact: true }).first()).toBeVisible();

  const ordersOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(ordersOverflow).toBeLessThanOrEqual(1);

  await page.getByRole("button", { name: /Request bill/i }).click();
  await expect(page.getByText(/Bill requested\. A team member will be with you/i)).toBeVisible({ timeout: 15_000 });

  // A bad QR gets a friendly recovery screen, not a blank page.
  const invalidPage = await browser.newPage();
  await invalidPage.goto("/t/definitely-not-a-table");
  await expect(invalidPage.getByRole("heading", { name: /open this table/i })).toBeVisible();
  await invalidPage.close();
});
