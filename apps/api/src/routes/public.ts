import { Router } from "express";
import rateLimit from "express-rate-limit";
import { CreateOrderSchema } from "@cafe/shared";
import { asyncHandler } from "../lib/asyncHandler.js";
import { config } from "../config/index.js";
import { UnauthorizedError, NotFoundError } from "../lib/errors.js";
import { getPublicMenu, resolveTableByCode, getSettings } from "../services/menuService.js";
import { createOrder, getOrder } from "../services/orderService.js";
import { openCustomerSession, requestBill, requestSession } from "../services/sessionService.js";
import { cancelCustomerOrderItem } from "../services/orderItemService.js";
import { getSessionBillView } from "../services/billingService.js";
import { signCustomerSessionToken } from "../lib/customerSession.js";
import { requireCustomerSession } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  emitOrderCreated,
  emitBillRequested,
  emitAssistance,
  emitItemStatus,
  emitOrderUpdated,
  emitSessionOpened,
} from "../socket/index.js";

export const publicRouter = Router();

const orderLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.ORDER_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
});

// QR lookups are unauthenticated, so they share the general request budget.
const tableLookupLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
});

// Opening a session writes state, so it gets a much tighter per-IP budget than
// a read-only lookup. A table only needs this once per visit.
const sessionOpenLimiter = rateLimit({
  windowMs: config.RATE_LIMIT_WINDOW_MS,
  max: config.SESSION_RATE_LIMIT_MAX,
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

// Resolve a table + its active session from an unpredictable QR token. When a
// session is orderable, mint a session-scoped token the customer uses for the
// rest of their visit (spec 6.1). No internal IDs or admin data in the payload.
publicRouter.get(
  "/tables/:tableCode",
  tableLookupLimiter,
  asyncHandler(async (req, res) => {
    const { table, activeSession } = await resolveTableByCode(String(req.params.tableCode));
    const canOrder = activeSession?.status === "ACTIVE";
    // An AVAILABLE table is orderable even before a session exists: the session
    // is opened lazily on the first order (not on scan), so the menu can show
    // Add buttons without turning browsing into an occupied table.
    const orderable = activeSession ? canOrder : table.status === "AVAILABLE";
    res.json({
      table: { number: table.number, status: table.status },
      session: activeSession
        ? { id: activeSession.id, status: activeSession.status, openedAt: activeSession.openedAt }
        : null,
      canOrder,
      orderable,
      sessionToken: canOrder && activeSession ? signCustomerSessionToken(activeSession.id, table.id) : null,
    });
  })
);

// Lazily open (or join) the table's orderable session. Called by the customer
// client when they first place an order, never on a bare scan. Idempotent:
// a second phone joins the same ACTIVE session; a retry returns the same row.
publicRouter.post(
  "/tables/:tableCode/session",
  sessionOpenLimiter,
  asyncHandler(async (req, res) => {
    const { table } = await resolveTableByCode(String(req.params.tableCode));
    const { session, created } = await openCustomerSession(table.id);
    const canOrder = session.status === "ACTIVE";
    if (created) {
      emitSessionOpened(
        {
          sessionId: session.id,
          tableNumber: table.number,
          status: session.status,
          source: "customer_qr",
        },
        session.id
      );
    }
    res.status(created ? 201 : 200).json({
      table: { number: table.number, status: canOrder ? "OCCUPIED" : table.status },
      session: { id: session.id, status: session.status, openedAt: session.openedAt },
      canOrder,
      orderable: canOrder,
      sessionToken: canOrder ? signCustomerSessionToken(session.id, table.id) : null,
    });
  })
);

// Customer-initiated "start ordering". Creates a PENDING session that a waiter
// confirms with one tap; no session token is minted until it is ACTIVE, so the
// server's ordering rules are unchanged.
publicRouter.post(
  "/tables/:tableCode/start-session",
  tableLookupLimiter,
  asyncHandler(async (req, res) => {
    const { table } = await resolveTableByCode(String(req.params.tableCode));
    await requestSession(table.id);
    const { table: freshTable, activeSession } = await resolveTableByCode(String(req.params.tableCode));
    const canOrder = activeSession?.status === "ACTIVE";
    res.status(201).json({
      table: { number: freshTable.number, status: freshTable.status },
      session: activeSession
        ? { id: activeSession.id, status: activeSession.status, openedAt: activeSession.openedAt }
        : null,
      canOrder,
      sessionToken:
        canOrder && activeSession ? signCustomerSessionToken(activeSession.id, freshTable.id) : null,
    });
  })
);

// Create an order. The session is taken from the signed session token; the
// server re-validates ACTIVE inside the transaction (spec 11.4).
publicRouter.post(
  "/orders",
  orderLimiter,
  requireCustomerSession(),
  asyncHandler(async (req, res) => {
    const body = CreateOrderSchema.parse(req.body);
    const sessionId = req.customerSession!.sessionId;
    const order = await createOrder({
      sessionId,
      items: body.items,
      idempotencyKey: body.idempotencyKey,
    });
    const table = await prisma.cafeTable.findUnique({ where: { id: order.tableId } });
    emitOrderCreated(
      {
        id: order.id,
        sessionId: order.sessionId,
        tableId: order.tableId,
        tableNumber: table?.number,
        orderNumber: order.orderNumber,
        status: order.status,
        totalMinor: order.totalMinor,
        createdAt: order.createdAt,
        items: order.items,
      },
      order.sessionId
    );
    res.status(201).json({ order });
  })
);

// Track one order, but only within the session the token authorizes.
publicRouter.get(
  "/orders/:orderId",
  requireCustomerSession(),
  asyncHandler(async (req, res) => {
    const order = await getOrder(String(req.params.orderId));
    // Scope by session: an order from another table's session looks like a 404.
    if (order.sessionId !== req.customerSession!.sessionId) {
      throw new NotFoundError("Order not found");
    }
    res.json({ order });
  })
);

// All orders for the authorized session only.
publicRouter.get(
  "/sessions/:sessionId/orders",
  requireCustomerSession(),
  asyncHandler(async (req, res) => {
    const session = await prisma.diningSession.findUnique({
      where: { id: String(req.params.sessionId) },
      include: {
        orders: {
          orderBy: { createdAt: "asc" },
          include: { items: { include: { addons: true }, orderBy: { createdAt: "asc" } } },
        },
      },
    });
    if (!session) throw new NotFoundError("Session not found");
    res.json({ session: { id: session.id, status: session.status }, orders: session.orders });
  })
);

// Itemised bill for the customer's own session. Returns a provisional preview
// until the waiter generates the immutable snapshot.
publicRouter.get(
  "/sessions/:sessionId/bill",
  requireCustomerSession(),
  asyncHandler(async (req, res) => {
    res.json(await getSessionBillView(req.customerSession!.sessionId));
  })
);

// A customer may withdraw a dish while it is still QUEUED.
publicRouter.post(
  "/order-items/:itemId/cancel",
  requireCustomerSession(),
  asyncHandler(async (req, res) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 200) : undefined;
    const result = await cancelCustomerOrderItem(
      String(req.params.itemId),
      req.customerSession!.sessionId,
      reason
    );
    const sessionId = result.order.sessionId;
    emitItemStatus(
      {
        orderId: result.order.id,
        orderStatus: result.order.status,
        sessionId,
        item: result.item,
        fromStatus: result.previousStatus,
        toStatus: result.item.status,
      },
      sessionId
    );
    if (result.orderStatusChanged) {
      emitOrderUpdated(
        { id: result.order.id, sessionId, status: result.order.status, updatedAt: new Date() },
        sessionId
      );
    }
    res.json({ item: result.item, order: result.order });
  })
);

publicRouter.post(
  "/sessions/:sessionId/request-bill",
  requireCustomerSession(),
  asyncHandler(async (req, res) => {
    const session = await requestBill(String(req.params.sessionId));
    const table = await prisma.cafeTable.findUnique({ where: { id: session.tableId } });
    emitBillRequested({ sessionId: session.id, tableNumber: table?.number }, session.id);
    res.json({ session });
  })
);

publicRouter.post(
  "/sessions/:sessionId/assistance",
  requireCustomerSession(),
  asyncHandler(async (req, res) => {
    const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 200) : null;
    const session = await prisma.diningSession.findUnique({ where: { id: String(req.params.sessionId) } });
    if (!session) throw new NotFoundError("Session not found");
    if (session.status === "CLOSED") throw new UnauthorizedError("This session is closed");
    const request = await prisma.assistanceRequest.create({
      data: { sessionId: session.id, tableId: session.tableId, message },
    });
    const table = await prisma.cafeTable.findUnique({ where: { id: session.tableId } });
    emitAssistance({ requestId: request.id, tableNumber: table?.number }, session.id);
    res.status(201).json({ request });
  })
);
