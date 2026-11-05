import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError, SessionClosedError } from "../lib/errors.js";
import type { SessionStatus } from "@prisma/client";

const ACTIVE_STATUSES: SessionStatus[] = [
  "PENDING",
  "ACTIVE",
  "BILL_REQUESTED",
  "PAYMENT_PENDING",
];

export interface Actor {
  id: string;
  role: string;
}

/**
 * A customer at a table can ask to start ordering from the QR page. This
 * creates a PENDING session: nobody can order yet, but the request appears on
 * the waiter dashboard for a one-tap confirmation. Existing open sessions are
 * returned unchanged so a double tap is harmless.
 */
export async function requestSession(tableId: string) {
  return prisma.$transaction(async (tx) => {
    const table = await tx.cafeTable.findUnique({ where: { id: tableId } });
    if (!table || !table.isActive) throw new NotFoundError("Table not found");

    await tx.$queryRaw`SELECT id FROM "CafeTable" WHERE id = ${tableId}::uuid FOR UPDATE`;

    const existing = await tx.diningSession.findFirst({
      where: { tableId, status: { in: ACTIVE_STATUSES } },
      orderBy: { openedAt: "desc" },
    });
    if (existing) return existing;

    const session = await tx.diningSession.create({
      data: { tableId, status: "PENDING", openedBy: null },
    });
    await tx.cafeTable.update({ where: { id: tableId }, data: { status: "OCCUPIED" } });
    await tx.auditLog.create({
      data: {
        actorId: null,
        action: "SESSION_REQUESTED",
        entityType: "DiningSession",
        entityId: session.id,
        metadata: { tableId },
      },
    });
    return session;
  });
}

/** Waiter confirmation of a customer-requested PENDING session. */
export async function confirmSession(sessionId: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.diningSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundError("Session not found");
    if (session.status === "CLOSED") throw new ConflictError("Session is closed", "SESSION_CLOSED");
    if (session.status !== "PENDING") return session;

    const updated = await tx.diningSession.update({
      where: { id: sessionId },
      data: { status: "ACTIVE", openedBy: actor.id },
    });
    await tx.cafeTable.update({ where: { id: session.tableId }, data: { status: "OCCUPIED" } });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "SESSION_CONFIRMED",
        entityType: "DiningSession",
        entityId: session.id,
        metadata: { tableId: session.tableId },
      },
    });
    return updated;
  });
}

export async function openSession(tableId: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const table = await tx.cafeTable.findUnique({ where: { id: tableId } });
    if (!table || !table.isActive) throw new NotFoundError("Table not found");

    await tx.$queryRaw`SELECT id FROM "CafeTable" WHERE id = ${tableId}::uuid FOR UPDATE`;

    const existing = await tx.diningSession.findFirst({
      where: { tableId, status: { in: ACTIVE_STATUSES } },
    });
    if (existing) throw new ConflictError("Table already has an active session", "SESSION_EXISTS");

    const session = await tx.diningSession.create({
      data: { tableId, openedBy: actor.id, status: "ACTIVE" },
    });
    await tx.cafeTable.update({ where: { id: tableId }, data: { status: "OCCUPIED" } });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "SESSION_OPENED",
        entityType: "DiningSession",
        entityId: session.id,
        metadata: { tableId },
      },
    });
    return session;
  });
}

export async function requestBill(sessionId: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.diningSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundError("Session not found");
    if (session.status === "CLOSED") throw new SessionClosedError();
    const updated = await tx.diningSession.update({
      where: { id: sessionId },
      data: { status: "BILL_REQUESTED" },
    });
    await tx.cafeTable.update({ where: { id: session.tableId }, data: { status: "BILL_REQUESTED" } });
    return updated;
  });
}

export async function closeSession(sessionId: string, actor: Actor, reason?: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.diningSession.findUnique({
      where: { id: sessionId },
      include: { bills: true },
    });
    if (!session) throw new NotFoundError("Session not found");
    if (session.status === "CLOSED") throw new ConflictError("Session already closed");

    const unpaidBill = session.bills.find((b) => b.status !== "PAID" && b.status !== "VOID");
    if (unpaidBill) {
      throw new ConflictError(
        "Cannot close session while an unpaid bill exists",
        "UNPAID_BALANCE"
      );
    }

    const activeOrders = await tx.order.count({
      where: { sessionId, status: { in: ["RECEIVED", "IN_PROGRESS", "PARTIALLY_READY", "READY"] } },
    });
    if (activeOrders > 0) {
      throw new ConflictError(
        "Cannot close session with unresolved orders",
        "UNRESOLVED_ORDERS"
      );
    }

    const updated = await tx.diningSession.update({
      where: { id: sessionId },
      data: { status: "CLOSED", closedAt: new Date(), closedBy: actor.id },
    });
    await tx.cafeTable.update({ where: { id: session.tableId }, data: { status: "AVAILABLE" } });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "SESSION_CLOSED",
        entityType: "DiningSession",
        entityId: sessionId,
        metadata: { reason: reason ?? null },
      },
    });
    return updated;
  });
}

export async function reopenSession(sessionId: string, actor: Actor, reason: string) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.diningSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundError("Session not found");
    if (session.status !== "CLOSED") throw new ConflictError("Only a closed session can be reopened");

    const otherActive = await tx.diningSession.findFirst({
      where: { tableId: session.tableId, status: { in: ACTIVE_STATUSES }, id: { not: sessionId } },
    });
    if (otherActive) throw new ConflictError("Table already has an active session", "SESSION_EXISTS");

    const updated = await tx.diningSession.update({
      where: { id: sessionId },
      data: { status: "ACTIVE", closedAt: null, closedBy: null },
    });
    await tx.cafeTable.update({ where: { id: session.tableId }, data: { status: "OCCUPIED" } });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "SESSION_REOPENED",
        entityType: "DiningSession",
        entityId: sessionId,
        metadata: { reason },
      },
    });
    return updated;
  });
}

export async function getSessionDetail(sessionId: string) {
  const session = await prisma.diningSession.findUnique({
    where: { id: sessionId },
    include: {
      table: true,
      orders: {
        orderBy: { createdAt: "desc" },
        include: { items: { include: { addons: true } } },
      },
      bills: { include: { payments: true, lineItems: true } },
      assistance: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!session) throw new NotFoundError("Session not found");
  return session;
}
