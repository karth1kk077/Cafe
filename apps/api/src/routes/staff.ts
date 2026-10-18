import { Router } from "express";
import { randomUUID } from "crypto";
import {
  OrderStatusSchema,
  TableCreateSchema,
  CloseSessionSchema,
  ReopenSessionSchema,
  PaymentRecordSchema,
} from "@cafe/shared";
import { asyncHandler } from "../lib/asyncHandler.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import { NotFoundError } from "../lib/errors.js";
import {
  openSession,
  closeSession,
  reopenSession,
  getSessionDetail,
} from "../services/sessionService.js";
import { updateOrderStatus, listOrders, getOrder } from "../services/orderService.js";
import { generateBill, recordPayment } from "../services/billingService.js";
import { getSettings, updateSettings } from "../services/menuService.js";
import { hashPassword } from "../services/authService.js";
import { RoleSchema } from "@cafe/shared";
import { emitOrderStatus, emitSessionClosed } from "../socket/index.js";
import { z } from "zod";

export const staffRouter = Router();
staffRouter.use(authenticate);

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
            orders: { where: { status: { notIn: ["SERVED", "CANCELLED"] } } },
            bills: true,
          },
        },
      },
    });
    res.json({ tables });
  })
);

staffRouter.post(
  "/tables",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = TableCreateSchema.parse(req.body);
    const qrToken = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const table = await prisma.cafeTable.create({ data: { number: body.number, qrToken } });
    res.status(201).json({ table });
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
    emitSessionClosed({ sessionId: session.id, tableNumber: table?.number }, table?.qrToken);
    res.json({ session });
  })
);

staffRouter.post(
  "/sessions/:sessionId/reopen",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = ReopenSessionSchema.parse(req.body);
    const session = await reopenSession(String(req.params.sessionId), req.user!, body.reason);
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

staffRouter.get(
  "/orders/:orderId",
  authorize("KITCHEN", "WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const order = await getOrder(String(req.params.orderId));
    res.json({ order });
  })
);

staffRouter.patch(
  "/orders/:orderId/status",
  authorize("KITCHEN", "WAITER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z.object({ status: OrderStatusSchema, note: z.string().max(200).optional() }).parse(req.body);
    const order = await updateOrderStatus(String(req.params.orderId), body.status, req.user!, body.note);
    const table = await prisma.cafeTable.findUnique({ where: { id: order.tableId } });
    emitOrderStatus({ ...order, tableNumber: table?.number }, table?.qrToken);
    res.json({ order });
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
staffRouter.get(
  "/admin/users",
  authorize("ADMIN"),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
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
      })
      .parse(req.body);
    const settings = await updateSettings(body);
    res.json({ settings });
  })
);

staffRouter.post(
  "/admin/menu/categories",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({ name: z.string().min(1).max(100), description: z.string().max(500).optional(), sortOrder: z.number().int().optional() })
      .parse(req.body);
    const category = await prisma.menuCategory.create({ data: body });
    res.status(201).json({ category });
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
        imageUrl: z.string().url().optional(),
        isAvailable: z.boolean().optional(),
        maxQuantity: z.number().int().min(1).max(100).optional(),
        dietaryTags: z.array(z.string()).optional(),
        allergens: z.array(z.string()).optional(),
      })
      .parse(req.body);
    const item = await prisma.menuItem.create({ data: body });
    res.status(201).json({ item });
  })
);

staffRouter.patch(
  "/admin/menu/items/:itemId",
  authorize("ADMIN"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(1).max(150).optional(),
        description: z.string().max(1000).optional(),
        priceMinor: z.number().int().positive().optional(),
        isAvailable: z.boolean().optional(),
      })
      .parse(req.body);
    const item = await prisma.menuItem.update({ where: { id: String(req.params.itemId) }, data: body });
    res.json({ item });
  })
);
