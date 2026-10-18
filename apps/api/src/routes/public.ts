import { Router } from "express";
import rateLimit from "express-rate-limit";
import { CreateOrderSchema } from "@cafe/shared";
import { asyncHandler } from "../lib/asyncHandler.js";
import { config } from "../config/index.js";
import { getPublicMenu, resolveTableByCode, getSettings } from "../services/menuService.js";
import { createOrder, getOrder } from "../services/orderService.js";
import { requestBill } from "../services/sessionService.js";
import { prisma } from "../lib/prisma.js";
import { NotFoundError } from "../lib/errors.js";
import { emitOrderCreated, emitBillRequested, emitAssistance } from "../socket/index.js";

export const publicRouter = Router();

const orderLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.ORDER_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
});

publicRouter.get(
  "/menu",
  asyncHandler(async (_req, res) => {
    const [categories, settings] = await Promise.all([getPublicMenu(), getSettings()]);
    res.json({ categories, settings: { cafeName: settings.cafeName, currency: settings.currency } });
  })
);

// Resolve a table + its active session from an unpredictable QR token.
publicRouter.get(
  "/tables/:tableCode",
  asyncHandler(async (req, res) => {
    const { table, activeSession } = await resolveTableByCode(String(req.params.tableCode));
    res.json({
      table: { id: table.id, number: table.number, status: table.status },
      session: activeSession
        ? { id: activeSession.id, status: activeSession.status, openedAt: activeSession.openedAt }
        : null,
      canOrder: activeSession?.status === "ACTIVE",
    });
  })
);

publicRouter.post(
  "/orders",
  orderLimiter,
  asyncHandler(async (req, res) => {
    const body = CreateOrderSchema.parse(req.body);
    const order = await createOrder({
      tableCode: body.tableCode,
      items: body.items,
      idempotencyKey: body.idempotencyKey,
    });
    const table = await prisma.cafeTable.findUnique({ where: { id: order.tableId } });
    emitOrderCreated(
      { id: order.id, tableId: order.tableId, tableNumber: table?.number, orderNumber: order.orderNumber, status: order.status, totalMinor: order.totalMinor, createdAt: order.createdAt },
      table?.qrToken
    );
    res.status(201).json({ order });
  })
);

// Track an order, but only within its owning table/session context.
publicRouter.get(
  "/orders/:orderId",
  asyncHandler(async (req, res) => {
    const order = await getOrder(String(req.params.orderId));
    res.json({
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        totalMinor: order.totalMinor,
        createdAt: order.createdAt,
        items: order.items,
      },
    });
  })
);

publicRouter.get(
  "/sessions/:sessionId/orders",
  asyncHandler(async (req, res) => {
    const session = await prisma.diningSession.findUnique({
      where: { id: String(req.params.sessionId) },
      include: { orders: { orderBy: { createdAt: "asc" }, include: { items: true } } },
    });
    if (!session) throw new NotFoundError("Session not found");
    res.json({ session: { id: session.id, status: session.status, orders: session.orders }, orders: session.orders });
  })
);

publicRouter.post(
  "/sessions/:sessionId/request-bill",
  asyncHandler(async (req, res) => {
    const session = await requestBill(String(req.params.sessionId));
    const table = await prisma.cafeTable.findUnique({ where: { id: session.tableId } });
    emitBillRequested({ sessionId: session.id, tableNumber: table?.number }, table?.qrToken);
    res.json({ session });
  })
);

publicRouter.post(
  "/sessions/:sessionId/assistance",
  asyncHandler(async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 200) : null;
    const session = await prisma.diningSession.findUnique({ where: { id: String(req.params.sessionId) } });
    if (!session) throw new NotFoundError("Session not found");
    const request = await prisma.assistanceRequest.create({
      data: { sessionId: session.id, tableId: session.tableId, message },
    });
    const table = await prisma.cafeTable.findUnique({ where: { id: session.tableId } });
    emitAssistance({ requestId: request.id, tableNumber: table?.number }, table?.qrToken);
    res.status(201).json({ request });
  })
);
