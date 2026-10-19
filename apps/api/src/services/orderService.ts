import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, SessionClosedError } from "../lib/errors.js";
import { applyBps, computeRounding } from "../lib/money.js";
import { getSettings } from "./menuService.js";

interface OrderItemInput {
  menuItemId: string;
  variantId?: string;
  addonIds?: string[];
  quantity: number;
  specialInstructions?: string;
}

export interface CreateOrderInput {
  /** The dining session resolved from the customer's session-scoped token. */
  sessionId: string;
  items: OrderItemInput[];
  idempotencyKey: string;
  actorId?: string;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Human-readable order number derived from a Postgres sequence so that
 * concurrent submissions from different tables can never collide (the legacy
 * count()+1 approach raced across sessions).
 */
async function generateOrderNumber(tx: Tx) {
  const rows = await tx.$queryRaw<Array<{ seq: bigint }>>`SELECT nextval('cafe_order_number_seq') AS seq`;
  const seq = String(rows[0]?.seq ?? 0).padStart(6, "0");
  return `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${seq}`;
}

export async function createOrder(input: CreateOrderInput) {
  if (!input.items.length) throw new ConflictError("Order must contain at least one item", "EMPTY_ORDER");

  return prisma.$transaction(async (tx) => {
    // Lock the dining session row and re-check ACTIVE inside the transaction.
    // This closes the check-then-insert race and rejects orders for closed or
    // stale sessions even if a customer page is still open (spec 1, 11.4).
    const locked = await tx.$queryRaw<Array<{ id: string; status: string; tableId: string }>>`
      SELECT id, status, "tableId" FROM "DiningSession"
      WHERE id = ${input.sessionId}::uuid
      FOR UPDATE
    `;
    const session = locked[0];
    if (!session || session.status !== "ACTIVE") throw new SessionClosedError();

    const table = await tx.cafeTable.findUnique({ where: { id: session.tableId } });
    if (!table || !table.isActive) throw new NotFoundError("Table not found");

    // Idempotency: return the original order for a repeated key on the same session.
    const existing = await tx.idempotencyKey.findUnique({ where: { key: input.idempotencyKey } });
    if (existing) {
      if (existing.sessionId !== session.id) {
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

    // Recompute everything from the database. Client prices/totals are ignored.
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
        include: {
          variants: { where: { isActive: true } },
          addons: { where: { isActive: true } },
        },
      });
      if (!menuItem) throw new NotFoundError("Menu item not found");
      if (!menuItem.isAvailable) throw new ConflictError(`Item unavailable: ${menuItem.name}`, "ITEM_UNAVAILABLE");
      if (item.quantity > menuItem.maxQuantity) {
        throw new ConflictError(`Quantity exceeds maximum for ${menuItem.name}`, "QUANTITY_EXCEEDED");
      }

      let unitPriceMinor = menuItem.priceMinor;
      let variantId: string | null = null;
      if (item.variantId) {
        const variant = menuItem.variants.find((v) => v.id === item.variantId);
        if (!variant) throw new ConflictError("Variant does not belong to this item", "INVALID_VARIANT");
        unitPriceMinor += variant.priceDeltaMinor;
        variantId = variant.id;
      }

      const resolvedAddons: Array<{ addonId: string; nameSnapshot: string; priceSnapshotMinor: number }> = [];
      for (const addonId of item.addonIds ?? []) {
        const addon = menuItem.addons.find((a) => a.id === addonId);
        if (!addon) throw new ConflictError("Add-on does not belong to this item", "INVALID_ADDON");
        unitPriceMinor += addon.priceMinor;
        resolvedAddons.push({ addonId: addon.id, nameSnapshot: addon.name, priceSnapshotMinor: addon.priceMinor });
      }

      const lineTotalMinor = unitPriceMinor * item.quantity;
      subtotalMinor += lineTotalMinor;
      preparedItems.push({
        menuItemId: menuItem.id,
        variantId,
        nameSnapshot: menuItem.name,
        unitPriceMinor,
        quantity: item.quantity,
        lineTotalMinor,
        specialInstructions: item.specialInstructions?.trim() || null,
        addons: resolvedAddons,
      });
    }

    // Authoritative totals are computed from the database, never the client.
    const taxMinor = applyBps(subtotalMinor, settings.taxRateBps);
    const serviceChargeMinor = applyBps(subtotalMinor, settings.serviceChargeBps);
    const preRounding = subtotalMinor + taxMinor + serviceChargeMinor;
    const roundingMinor = computeRounding(preRounding, settings.roundingEnabled);
    const totalMinor = preRounding + roundingMinor;
    const orderNumber = await generateOrderNumber(tx);

    const order = await tx.order.create({
      data: {
        orderNumber,
        sessionId: session.id,
        tableId: table.id,
        status: "RECEIVED",
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
            status: "QUEUED",
            addons: { create: pi.addons },
          })),
        },
        statusHistory: { create: { toStatus: "RECEIVED", changedBy: input.actorId ?? null } },
      },
      include: { items: { include: { addons: true } } },
    });

    // Record the birth of each line item in the per-item audit trail.
    await tx.orderItemEvent.createMany({
      data: order.items.map((it) => ({
        orderItemId: it.id,
        orderId: order.id,
        fromStatus: null,
        toStatus: "QUEUED" as const,
        actorId: input.actorId ?? null,
        source: "CUSTOMER",
      })),
    });

    await tx.idempotencyKey.create({
      data: {
        key: input.idempotencyKey,
        sessionId: session.id,
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

export async function listOrders(filter: { status?: string[]; sessionId?: string; tableId?: string }) {
  return prisma.order.findMany({
    where: {
      ...(filter.status ? { status: { in: filter.status as never[] } } : {}),
      ...(filter.sessionId ? { sessionId: filter.sessionId } : {}),
      ...(filter.tableId ? { tableId: filter.tableId } : {}),
    },
    orderBy: { createdAt: "asc" },
    include: { table: true, items: { include: { addons: true }, orderBy: { createdAt: "asc" } } },
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
