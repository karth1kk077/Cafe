import { Router } from "express";
import { randomUUID } from "crypto";
import {
  TableCreateSchema,
  CloseSessionSchema,
  ReopenSessionSchema,
  PaymentRecordSchema,
  UpdateOrderItemStatusSchema,
  CancelOrderItemSchema,
} from "@cafe/shared";
import { asyncHandler } from "../lib/asyncHandler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { buildTableQrUrl } from "../lib/qr.js";
import {
  openSession,
  confirmSession,
  closeSession,
  reopenSession,
  getSessionDetail,
  SELF_SERVICE_EMAIL,
} from "../services/sessionService.js";
import { listOrders, getOrder } from "../services/orderService.js";
import {
  cancelOrderItem,
  listReadyItems,
  transitionOrderItem,
} from "../services/orderItemService.js";
import { generateBill, recordPayment } from "../services/billingService.js";
import { getAdminMenu, getSettings, updateSettings } from "../services/menuService.js";
import { hashPassword } from "../services/authService.js";
import { RoleSchema } from "@cafe/shared";
import {
  emitItemStatus,
  emitOrderUpdated,
  emitSessionClosed,
  emitSessionReopened,
  emitMenuUpdated,
} from "../socket/index.js";
import { z } from "zod";

export const staffRouter = Router();
staffRouter.use(authenticate);

/**
 * Broadcast a line-item transition and, when it changed the derived order
 * summary, the order update too (spec 13).
 */
function broadcastItemTransition(result: Awaited<ReturnType<typeof transitionOrderItem>>) {
  const sessionId = result.order.sessionId;
  const payload = {
    orderId: result.order.id,
    orderStatus: result.order.status,
    sessionId,
    item: result.item,
    fromStatus: result.previousStatus,
    toStatus: result.item.status,
  };
  emitItemStatus(payload, sessionId);
  if (result.orderStatusChanged) {
    emitOrderUpdated(
      { id: result.order.id, sessionId, status: result.order.status, updatedAt: new Date() },
      sessionId
    );
  }
}

// ---- Tables & sessions (waiter/admin) ----
staffRouter.get(
  "/tables",
  asyncHandler(async (_req, res) => {
    const tables = await prisma.cafeTable.findMany({
      orderBy: { number: "asc" },
      include: {
        sessions: {
          where: { status: { not: "CLOSED" } },
          orderBy: { openedAt: "desc" },
          take: 1,
          include: {
            orders: {
              where: { status: { notIn: ["COMPLETED", "CANCELLED"] } },
              include: { items: true },
            },
            bills: { include: { lineItems: true, payments: true } },
          },
        },
      },
    });
    res.json({ tables });
  })
);

/**
 * Table labels are unique per café. The DB constraint catches exact matches
 * (P2002 -> 409); this check adds the case-insensitive duplicate rule and a
 * clear message, excluding the table being renamed.
 */
async function assertTableNumberAvailable(number: string, excludeTableId?: string) {
  const existing = await prisma.cafeTable.findFirst({
    where: {
      number: { equals: number, mode: "insensitive" },
      ...(excludeTableId ? { id: { not: excludeTableId } } : {}),
    },
    select: { id: true },
  });
  if (existing) throw new ConflictError("A table with this number already exists", "DUPLICATE");
}

staffRouter.post(
  "/tables",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = TableCreateSchema.parse(req.body);
    await assertTableNumberAvailable(body.number);
    const qrToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const table = await prisma.cafeTable.create({
      data: { number: body.number, qrToken, ...(body.seats !== undefined ? { seats: body.seats } : {}) },
    });
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.id,
        action: "TABLE_CREATED",
        entityType: "CafeTable",
        entityId: table.id,
        metadata: { number: table.number },
      },
    });
    res.status(201).json({ table: { ...table, qrUrl: buildTableQrUrl(table.qrToken) } });
  })
);

// Update a table, optionally rotating its QR token (leaked/stale QR remediation).
staffRouter.patch(
  "/tables/:tableId",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const tableId = String(req.params.tableId);
    const body = z
      .object({
        number: z.string().trim().min(1).max(20).optional(),
        seats: z.number().int().min(1).max(50).optional(),
        isActive: z.boolean().optional(),
        rotateQr: z.boolean().optional(),
      })
      .parse(req.body);

    if (body.number !== undefined) await assertTableNumberAvailable(body.number, tableId);

    const data: Record<string, unknown> = {};
    if (body.number !== undefined) data.number = body.number;
    if (body.seats !== undefined) data.seats = body.seats;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (body.rotateQr) data.qrToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

    const table = await prisma.cafeTable.update({ where: { id: tableId }, data });
    const action = body.rotateQr
      ? "TABLE_QR_ROTATED"
      : body.isActive === false
        ? "TABLE_DEACTIVATED"
        : body.isActive === true
          ? "TABLE_ACTIVATED"
          : "TABLE_UPDATED";
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.id,
        action,
        entityType: "CafeTable",
        entityId: table.id,
        metadata: { number: table.number },
      },
    });
    res.json({ table: { ...table, qrUrl: buildTableQrUrl(table.qrToken) } });
  })
);

staffRouter.post(
  "/tables/:tableId/sessions",
  authorize("WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const session = await openSession(String(req.params.tableId), req.user!);
    res.status(201).json({ session });
  })
);

// One-tap confirmation for a customer-requested PENDING session.
staffRouter.post(
  "/sessions/:sessionId/confirm",
  authorize("WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const session = await confirmSession(String(req.params.sessionId), req.user!);
    res.json({ session });
  })
);

staffRouter.get(
  "/sessions/:sessionId",
  authorize("WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const detail = await getSessionDetail(String(req.params.sessionId));
    res.json({ session: detail });
  })
);

staffRouter.post(
  "/sessions/:sessionId/close",
  authorize("WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const body = CloseSessionSchema.parse(req.body);
    const session = await closeSession(String(req.params.sessionId), req.user!, body.reason);
    const table = await prisma.cafeTable.findUnique({ where: { id: session.tableId } });
    emitSessionClosed({ sessionId: session.id, tableNumber: table?.number }, session.id);
    res.json({ session });
  })
);

staffRouter.post(
  "/sessions/:sessionId/reopen",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = ReopenSessionSchema.parse(req.body);
    const session = await reopenSession(String(req.params.sessionId), req.user!, body.reason);
    emitSessionReopened({ sessionId: session.id, status: session.status }, session.id);
    res.json({ session });
  })
);

// ---- Orders (kitchen/waiter/admin) ----
staffRouter.get(
  "/orders",
  authorize("KITCHEN", "WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const statusParam = typeof req.query.status === "string" ? req.query.status.split(",") : undefined;
    const orders = await listOrders({ status: statusParam });
    res.json({ orders });
  })
);

// Ready-dish queue: all items awaiting collection, oldest first (spec 8.2).
staffRouter.get(
  "/order-items/ready",
  authorize("WAITER", "ADMIN"),
  asyncHandler(async (_req, res) => {
    const items = await listReadyItems();
    res.json({ items });
  })
);

staffRouter.get(
  "/orders/:orderId",
  authorize("KITCHEN", "WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const order = await getOrder(String(req.params.orderId));
    res.json({ order });
  })
);

// Move a single line item through its lifecycle. Role + transition legality are
// enforced in the service against the central transition table (spec 7.2/14).
staffRouter.patch(
  "/order-items/:itemId/status",
  authorize("KITCHEN", "WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const body = UpdateOrderItemStatusSchema.parse(req.body);
    const result = await transitionOrderItem({
      itemId: String(req.params.itemId),
      toStatus: body.status,
      actor: { id: req.user!.id, role: req.user!.role },
      source: "STAFF",
      reason: body.note,
    });
    broadcastItemTransition(result);
    res.json({ item: result.item, order: result.order });
  })
);

// Cancel a single line item (supervisor authorization for post-prep cancels).
staffRouter.post(
  "/order-items/:itemId/cancel",
  authorize("KITCHEN", "WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const body = CancelOrderItemSchema.parse(req.body);
    const result = await cancelOrderItem(String(req.params.itemId), { id: req.user!.id, role: req.user!.role }, body.reason);
    broadcastItemTransition(result);
    res.json({ item: result.item, order: result.order });
  })
);

// ---- Billing (waiter/admin) ----
staffRouter.post(
  "/bills/generate",
  authorize("WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z.object({ sessionId: z.string().uuid() }).parse(req.body);
    const bill = await generateBill(body.sessionId, req.user!);
    res.status(201).json({ bill });
  })
);

staffRouter.get(
  "/bills/:billId",
  authorize("WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const bill = await prisma.bill.findUnique({
      where: { id: String(req.params.billId) },
      include: { lineItems: true, payments: true, table: true, session: true },
    });
    if (!bill) throw new NotFoundError("Bill not found");
    res.json({ bill });
  })
);

staffRouter.post(
  "/payments",
  authorize("WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const body = PaymentRecordSchema.parse(req.body);
    const result = await recordPayment(body, req.user!);
    res.status(201).json(result);
  })
);

// ---- Assistance (waiter/admin) ----
staffRouter.get(
  "/assistance",
  authorize("WAITER", "ADMIN"),
  asyncHandler(async (_req, res) => {
    const requests = await prisma.assistanceRequest.findMany({
      where: { status: { in: ["OPEN", "IN_PROGRESS"] } },
      orderBy: { createdAt: "asc" },
      include: { table: true },
    });
    res.json({ requests });
  })
);

staffRouter.patch(
  "/assistance/:id",
  authorize("WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]) }).parse(req.body);
    const request = await prisma.assistanceRequest.update({
      where: { id: String(req.params.id) },
      data: { status: body.status, assignedTo: req.user!.id },
    });
    res.json({ request });
  })
);

// ---- Admin: menu, staff, settings, audit ----

// Tables with their QR metadata for the Admin -> Tables & QR Codes page.
// The QR image itself is rendered client-side from `qrUrl`, so no image files
// are stored (plan 5).
staffRouter.get(
  "/admin/tables",
  authorize("ADMIN"),
  asyncHandler(async (_req, res) => {
    const tables = await prisma.cafeTable.findMany({
      orderBy: { number: "asc" },
      include: {
        sessions: {
          where: { status: { not: "CLOSED" } },
          orderBy: { openedAt: "desc" },
          take: 1,
          select: { id: true, status: true, openedAt: true },
        },
      },
    });
    res.json({
      tables: tables.map(({ sessions, ...table }) => ({
        ...table,
        qrUrl: buildTableQrUrl(table.qrToken),
        activeSession: sessions[0] ?? null,
      })),
    });
  })
);

staffRouter.get(
  "/admin/users",
  authorize("ADMIN"),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      // The QR self-service actor is an implementation detail, never a staff
      // account an admin can edit or deactivate.
      where: { email: { not: SELF_SERVICE_EMAIL } },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json({ users });
  })
);

staffRouter.post(
  "/admin/users",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(6).max(128),
        name: z.string().min(1).max(100),
        role: RoleSchema,
      })
      .parse(req.body);
    const passwordHash = await hashPassword(body.password);
    const user = await prisma.user.create({
      data: { email: body.email, name: body.name, role: body.role, passwordHash },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    await prisma.auditLog.create({
      data: { actorId: req.user!.id, action: "USER_CREATED", entityType: "User", entityId: user.id },
    });
    res.status(201).json({ user });
  })
);

// Edit or deactivate a staff account. Deactivation takes effect immediately
// because authenticate() now re-checks isActive on every request.
staffRouter.patch(
  "/admin/users/:userId",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1).max(100).optional(),
        role: RoleSchema.optional(),
        isActive: z.boolean().optional(),
        password: z.string().min(6).max(128).optional(),
      })
      .parse(req.body);
    if (req.params.userId === req.user!.id && body.isActive === false) {
      throw new ConflictError("You cannot deactivate your own account", "SELF_DEACTIVATION");
    }
    const user = await prisma.user.update({
      where: { id: String(req.params.userId) },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.password ? { passwordHash: await hashPassword(body.password) } : {}),
      },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.id,
        action: body.isActive === false ? "USER_DEACTIVATED" : body.isActive === true ? "USER_ACTIVATED" : "USER_UPDATED",
        entityType: "User",
        entityId: user.id,
      },
    });
    res.json({ user });
  })
);

staffRouter.get(
  "/admin/audit",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const take = Math.min(Number(req.query.limit) || 50, 200);
    const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take });
    res.json({ logs });
  })
);

staffRouter.get(
  "/admin/settings",
  authorize("ADMIN"),
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getSettings() });
  })
);

staffRouter.patch(
  "/admin/settings",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        cafeName: z.string().min(1).max(100).optional(),
        currency: z.string().length(3).optional(),
        taxRateBps: z.number().int().min(0).max(10000).optional(),
        serviceChargeBps: z.number().int().min(0).max(10000).optional(),
        roundingEnabled: z.boolean().optional(),
        upiId: z.string().max(100).nullable().optional(),
      })
      .parse(req.body);
    const settings = await updateSettings(body);
    emitMenuUpdated({ type: "settings" });
    res.json({ settings });
  })
);

staffRouter.get(
  "/admin/menu",
  authorize("ADMIN"),
  asyncHandler(async (_req, res) => {
    res.json({ categories: await getAdminMenu() });
  })
);

staffRouter.post(
  "/admin/menu/categories",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({ name: z.string().min(1).max(100), description: z.string().max(500).optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional() })
      .parse(req.body);
    const category = await prisma.menuCategory.create({ data: body });
    emitMenuUpdated({ type: "menu" });
    res.status(201).json({ category });
  })
);

staffRouter.patch(
  "/admin/menu/categories/:categoryId",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({ name: z.string().min(1).max(100).optional(), description: z.string().max(500).optional(), sortOrder: z.number().int().optional(), isActive: z.boolean().optional() })
      .parse(req.body);
    const category = await prisma.menuCategory.update({ where: { id: String(req.params.categoryId) }, data: body });
    emitMenuUpdated({ type: "menu" });
    res.json({ category });
  })
);

staffRouter.post(
  "/admin/menu/items",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        categoryId: z.string().uuid(),
        name: z.string().min(1).max(150),
        description: z.string().max(1000).optional(),
        priceMinor: z.number().int().positive(),
        imageUrl: z.string().url().optional().or(z.literal("")),
        isAvailable: z.boolean().optional(),
        maxQuantity: z.number().int().min(1).max(100).optional(),
        dietaryTags: z.array(z.string()).optional(),
        allergens: z.array(z.string()).optional(),
        sortOrder: z.number().int().optional(),
      })
      .parse(req.body);
    const data = { ...body, imageUrl: body.imageUrl ? body.imageUrl : null };
    const item = await prisma.menuItem.create({ data });
    emitMenuUpdated({ type: "menu" });
    res.status(201).json({ item });
  })
);

staffRouter.patch(
  "/admin/menu/items/:itemId",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        categoryId: z.string().uuid().optional(),
        name: z.string().min(1).max(150).optional(),
        description: z.string().max(1000).optional(),
        priceMinor: z.number().int().positive().optional(),
        imageUrl: z.string().url().optional().or(z.literal("")).nullable(),
        isAvailable: z.boolean().optional(),
        maxQuantity: z.number().int().min(1).max(100).optional(),
        dietaryTags: z.array(z.string()).optional(),
        allergens: z.array(z.string()).optional(),
        sortOrder: z.number().int().optional(),
      })
      .parse(req.body);
    const data = {
      ...body,
      ...(body.imageUrl === "" ? { imageUrl: null } : {}),
    };
    const item = await prisma.menuItem.update({ where: { id: String(req.params.itemId) }, data });
    emitMenuUpdated({ type: "menu" });
    res.json({ item });
  })
);
