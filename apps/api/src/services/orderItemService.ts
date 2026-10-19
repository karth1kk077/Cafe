import { prisma } from "../lib/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../lib/errors.js";
import {
  canRoleTransition,
  deriveOrderSummary,
  isTransitionAllowed,
  timestampFieldFor,
  type ItemStatus,
} from "../lib/orderState.js";
import type { Role } from "@cafe/shared";

export interface ItemActor {
  id: string;
  role: Role;
}

export interface TransitionInput {
  itemId: string;
  toStatus: ItemStatus;
  actor?: ItemActor | null;
  source?: "STAFF" | "CUSTOMER" | "SYSTEM";
  reason?: string;
}

/**
 * Move a single order line item through its lifecycle (spec 7.2).
 *
 * - Runs in a transaction and takes a row lock so two staff members cannot
 *   apply conflicting transitions concurrently (spec 14).
 * - Enforces the central transition table AND role permissions on the server.
 * - Appends an immutable OrderItemEvent and an AuditLog entry.
 * - Recomputes the derived order-level summary (spec 11.2).
 */
export async function transitionOrderItem(input: TransitionInput) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; status: ItemStatus; orderId: string }>>`
      SELECT id, status, "orderId" FROM "OrderItem"
      WHERE id = ${input.itemId}::uuid
      FOR UPDATE
    `;
    const row = locked[0];
    if (!row) throw new NotFoundError("Order item not found");

    const from = row.status;
    const to = input.toStatus;
    const source = input.source ?? "STAFF";

    if (from === to) {
      throw new ConflictError(`Item is already ${to}`, "NO_OP_TRANSITION");
    }
    if (!isTransitionAllowed(from, to)) {
      throw new ConflictError(`Invalid item transition ${from} -> ${to}`, "INVALID_TRANSITION");
    }
    if (source === "STAFF") {
      if (!input.actor || !canRoleTransition(input.actor.role, from, to)) {
        throw new ForbiddenError("Your role cannot perform this item transition");
      }
    }

    const now = new Date();
    const timestampField = timestampFieldFor(to);

    const item = await tx.orderItem.update({
      where: { id: input.itemId },
      data: {
        status: to,
        ...(timestampField ? { [timestampField]: now } : {}),
        ...(to === "CANCELLED" ? { cancelReason: input.reason ?? null } : {}),
      },
      include: { addons: true },
    });

    await tx.orderItemEvent.create({
      data: {
        orderItemId: input.itemId,
        orderId: row.orderId,
        fromStatus: from,
        toStatus: to,
        actorId: input.actor?.id ?? null,
        source,
        reason: input.reason ?? null,
      },
    });

    // Recompute the derived order summary from all of the order's items.
    const items = await tx.orderItem.findMany({
      where: { orderId: row.orderId },
      select: { status: true },
    });
    const summary = deriveOrderSummary(items);

    const current = await tx.order.findUniqueOrThrow({
      where: { id: row.orderId },
      select: { id: true, status: true, sessionId: true },
    });
    const previousOrderStatus = current.status;
    let order = current;
    if (previousOrderStatus !== summary) {
      order = await tx.order.update({
        where: { id: row.orderId },
        data: { status: summary },
        select: { id: true, status: true, sessionId: true },
      });
      await tx.orderStatusHistory.create({
        data: { orderId: row.orderId, fromStatus: previousOrderStatus, toStatus: summary, changedBy: input.actor?.id ?? null },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: input.actor?.id ?? null,
        action: to === "CANCELLED" ? "ORDER_ITEM_CANCELLED" : "ORDER_ITEM_STATUS_CHANGED",
        entityType: "OrderItem",
        entityId: input.itemId,
        metadata: { from, to, orderId: row.orderId, source, reason: input.reason ?? null },
      },
    });

    return {
      item,
      order,
      previousStatus: from,
      orderStatusChanged: previousOrderStatus !== summary,
      previousOrderStatus,
    };
  });
}

export async function cancelOrderItem(itemId: string, actor: ItemActor, reason?: string) {
  return transitionOrderItem({ itemId, toStatus: "CANCELLED", actor, source: "STAFF", reason });
}

/** All dishes currently READY and awaiting collection, oldest first (spec 8.2). */
export async function listReadyItems() {
  return prisma.orderItem.findMany({
    where: { status: "READY" },
    orderBy: { readyAt: "asc" },
    include: {
      addons: true,
      order: { include: { table: true, session: true } },
    },
  });
}

export async function getItemEvents(itemId: string) {
  return prisma.orderItemEvent.findMany({
    where: { orderItemId: itemId },
    orderBy: { createdAt: "asc" },
  });
}
