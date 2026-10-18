import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, SessionClosedError } from "../lib/errors.js";
import { applyBps, computeRounding, sumMinor } from "../lib/money.js";
import { getSettings } from "./menuService.js";
import { OrderStatus } from "@prisma/client";

interface OrderItemInput {
  menuItemId: string;
  variantId?: string;
  addonIds?: string[];
  quantity: number;
  specialInstructions?: string;
}

export interface CreateOrderInput {
  tableCode: string;
  items: OrderItemInput[];
  idempotencyKey: string;
  actorId?: string;
}

async function generateOrderNumber(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  const count = await tx.order.count();
  const seq = String(count + 1).padStart(6, "0");
  return `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${seq}`;
}

export async function createOrder(input: CreateOrderInput) {
  if (!input.items.length) throw new ConflictError("Order must contain at least one item", "EMPTY_ORDER");

  return prisma.$transaction(async (tx) => {
    // Resolve table via unpredictable QR token. Never trust a raw table id from the client.
    const table = await tx.cafeTable.findUnique({ where: { qrToken: input.tableCode } });
    if (!table || !table.isActive) throw new NotFoundError("Table not found");

    // Lock the corresponding open session row to serialize concurrent submissions.
    const locked = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status FROM "DiningSession"
      WHERE "tableId" = ${table.id}::uuid AND status <> 'CLOSED'
      ORDER BY "openedAt" DESC
      LIMIT 1
      FOR UPDATE
    `;
    const sessionId = locked[0]?.id;
    const sessionStatus = locked[0]?.status;

    // CRITICAL BUSINESS RULE: no orders unless session is ACTIVE.
    if (!sessionId || sessionStatus !== "ACTIVE") {
      throw new SessionClosedError();
    }

    // Idempotency: if this key was already processed for this session, return the existing order.
    const existing = await tx.idempotencyKey.findUnique({ where: { key: input.idempotencyKey } });
    if (existing) {
      if (existing.sessionId !== sessionId) {
        throw new ConflictError("Idempotency key reused for a different session", "IDEMPOTENCY_CONFLICT");
      }
      if (existing.resourceId) {
        const prior = await tx.order.findUnique({
          where: { id: existing.resourceId },
          include: { items: { include: { addons: true } } },
        });
        if (prior) return prior;
      }
    }

    const settings = await getSettings();

    // Recompute everything from the database. Client prices/totals are ignored entirely.
    let subtotalMinor = 0;
    const preparedItems: Array<{
      menuItemId: string;
      variantId: string | null;
      nameSnapshot: string;
      unitPriceMinor: number;
      quantity: number;
      lineTotalMinor: number;
      specialInstructions: string | null;
      addons: Array<{ addonId: string; nameSnapshot: string; priceSnapshotMinor: number }>;
    }> = [];

    for (const item of input.items) {
      const menuItem = await tx.menuItem.findUnique({
        where: { id: item.menuItemId },
        include: { variants: true, addons: true },
      });
      if (!menuItem || !menuItem.isAvailable) {
        throw new ConflictError(`Item unavailable: ${item.menuItemId}`, "ITEM_UNAVAILABLE");
      }
      if (item.quantity < 1 || item.quantity > menuItem.maxQuantity) {
        throw new ConflictError(`Invalid quantity for ${menuItem.name}`, "INVALID_QUANTITY");
      }

      let unitPrice = menuItem.priceMinor;
      let variantId: string | null = null;
      if (item.variantId) {
        const variant = menuItem.variants.find((v) => v.id === item.variantId && v.isActive);
        if (!variant) throw new ConflictError(`Invalid variant for ${menuItem.name}`, "INVALID_VARIANT");
        unitPrice += variant.priceDeltaMinor;
        variantId = variant.id;
      }

      const resolvedAddons: Array<{ addonId: string; nameSnapshot: string; priceSnapshotMinor: number }> = [];
      for (const addonId of item.addonIds ?? []) {
        const addon = menuItem.addons.find((a) => a.id === addonId && a.isActive);
        if (!addon) throw new ConflictError(`Invalid add-on for ${menuItem.name}`, "INVALID_ADDON");
        unitPrice += addon.priceMinor;
        resolvedAddons.push({ addonId: addon.id, nameSnapshot: addon.name, priceSnapshotMinor: addon.priceMinor });
      }

      const lineTotal = unitPrice * item.quantity;
      subtotalMinor += lineTotal;
      preparedItems.push({
        menuItemId: menuItem.id,
        variantId,
        nameSnapshot: menuItem.name,
        unitPriceMinor: unitPrice,
        quantity: item.quantity,
        lineTotalMinor: lineTotal,
        specialInstructions: item.specialInstructions?.trim() || null,
        addons: resolvedAddons,
      });
    }

    const taxMinor = applyBps(subtotalMinor, settings.taxRateBps);
    const serviceChargeMinor = applyBps(subtotalMinor, settings.serviceChargeBps);
    const preRounding = sumMinor([subtotalMinor, taxMinor, serviceChargeMinor]);
    const roundingMinor = computeRounding(preRounding, settings.roundingEnabled);
    const totalMinor = preRounding + roundingMinor;

    const orderNumber = await generateOrderNumber(tx);

    const order = await tx.order.create({
      data: {
        orderNumber,
        sessionId,
        tableId: table.id,
        status: "PENDING",
        subtotalMinor,
        taxMinor,
        serviceChargeMinor,
        totalMinor,
        currency: settings.currency,
        createdBy: input.actorId ?? null,
        items: {
          create: preparedItems.map((pi) => ({
            menuItemId: pi.menuItemId,
            variantId: pi.variantId,
            nameSnapshot: pi.nameSnapshot,
            unitPriceMinor: pi.unitPriceMinor,
            quantity: pi.quantity,
            lineTotalMinor: pi.lineTotalMinor,
            specialInstructions: pi.specialInstructions,
            currency: settings.currency,
            addons: { create: pi.addons },
          })),
        },
        statusHistory: { create: { toStatus: "PENDING", changedBy: input.actorId ?? null } },
      },
      include: { items: { include: { addons: true } } },
    });

    await tx.idempotencyKey.create({
      data: {
        key: input.idempotencyKey,
        sessionId,
        resourceId: order.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await tx.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: "ORDER_CREATED",
        entityType: "Order",
        entityId: order.id,
        metadata: { tableId: table.id, totalMinor, orderNumber },
      },
    });

    return order;
  });
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["SERVED"],
  SERVED: [],
  CANCELLED: [],
};

export async function updateOrderStatus(
  orderId: string,
  toStatus: keyof typeof ALLOWED_TRANSITIONS,
  actor: { id: string; role: string },
  note?: string
) {
  return prisma.$transaction(async (tx) => {
    const existingOrder = await tx.order.findUnique({ where: { id: orderId } });
    if (!existingOrder) throw new NotFoundError("Order not found");

    const allowed = ALLOWED_TRANSITIONS[existingOrder.status] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new ConflictError(
        `Invalid transition ${existingOrder.status} -> ${toStatus}`,
        "INVALID_TRANSITION"
      );
    }

    const order = await tx.order.update({ where: { id: orderId }, data: { status: toStatus as OrderStatus } });
    await tx.orderStatusHistory.create({
      data: { orderId, fromStatus: existingOrder.status, toStatus: toStatus as OrderStatus, changedBy: actor.id, note: note ?? null },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "ORDER_STATUS_CHANGED",
        entityType: "Order",
        entityId: orderId,
        metadata: { from: existingOrder.status, to: toStatus },
      },
    });
    return order;
  });
}

export async function listOrders(filter: { status?: string[]; sessionId?: string; tableId?: string }) {
  return prisma.order.findMany({
    where: {
      ...(filter.status ? { status: { in: filter.status as never[] } } : {}),
      ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
      ...(filter.tableId ? { tableId: filter.tableId } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: { table: true, items: { include: { addons: true } } },
  });
}

export async function getOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { table: true, items: { include: { addons: true } }, statusHistory: true },
  });
  if (!order) throw new NotFoundError("Order not found");
  return order;
}
