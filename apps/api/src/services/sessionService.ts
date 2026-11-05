import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { config } from "../config/index.js";
import { ConflictError, NotFoundError, SessionClosedError } from "../lib/errors.js";
import type { SessionStatus } from "@prisma/client";

const ACTIVE_STATUSES: SessionStatus[] = [
  "PENDING",
  "ACTIVE",
  "BILL_REQUESTED",
  "PAYMENT_PENDING",
];

/**
 * A non-login system actor used for sessions opened directly by a customer QR
 * scan. `DiningSession.openedBy` stays a required-in-practice FK without a
 * migration, and the account never appears in staff user lists. The password
 * hash is random and unusable, so nobody can sign in as this account.
 */
export const SELF_SERVICE_EMAIL = "system+self-service@cafe.local";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function ensureSelfServiceUser(tx: Tx): Promise<string> {
  const existing = await tx.user.findUnique({
    where: { email: SELF_SERVICE_EMAIL },
    select: { id: true },
  });
  if (existing) return existing.id;
  const user = await tx.user.upsert({
    where: { email: SELF_SERVICE_EMAIL },
    update: {},
    create: {
      email: SELF_SERVICE_EMAIL,
      name: "Self-service",
      role: "CUSTOMER",
      passwordHash: await bcrypt.hash(randomUUID(), 10),
    },
    select: { id: true },
  });
  return user.id;
}

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

/**
 * Lazily open (or join) the orderable session for a table from a customer QR
 * scan. This is deliberately idempotent: a second phone scanning the same QR
 * joins the existing session, and a retry after a flaky connection returns the
 * same row instead of creating a second one. The table row is locked FOR UPDATE
 * so two simultaneous first orders cannot open two sessions.
 *
 * PENDING sessions created by the legacy "start ordering" flow are promoted to
 * ACTIVE here, because the QR-first flow no longer requires a waiter hand-off.
 */
export async function openCustomerSession(tableId: string) {
  return prisma.$transaction(async (tx) => {
    const table = await tx.cafeTable.findUnique({ where: { id: tableId } });
    if (!table || !table.isActive) throw new NotFoundError("Table not found");

    await tx.$queryRaw`SELECT id FROM "CafeTable" WHERE id = ${tableId}::uuid FOR UPDATE`;

    const existing = await tx.diningSession.findFirst({
      where: { tableId, status: { in: ACTIVE_STATUSES } },
      orderBy: { openedAt: "desc" },
    });

    if (existing && existing.status !== "PENDING") {
      return { session: existing, created: false };
    }

    const systemUserId = await ensureSelfServiceUser(tx);

    if (existing) {
      // Promote a legacy waiter-gated PENDING session without creating a
      // second session for the same group.
      const session = await tx.diningSession.update({
        where: { id: existing.id },
        data: { status: "ACTIVE", openedBy: existing.openedBy ?? systemUserId },
      });
      await tx.cafeTable.update({ where: { id: tableId }, data: { status: "OCCUPIED" } });
      await tx.auditLog.create({
        data: {
          actorId: systemUserId,
          action: "SESSION_OPENED",
          entityType: "DiningSession",
          entityId: session.id,
          metadata: { tableId, source: "customer_qr", promotedFrom: "PENDING" },
        },
      });
      return { session, created: true };
    }

    const session = await tx.diningSession.create({
      data: { tableId, openedBy: systemUserId, status: "ACTIVE" },
    });
    await tx.cafeTable.update({ where: { id: tableId }, data: { status: "OCCUPIED" } });
    await tx.auditLog.create({
      data: {
        actorId: systemUserId,
        action: "SESSION_OPENED",
        entityType: "DiningSession",
        entityId: session.id,
        metadata: { tableId, source: "customer_qr" },
      },
    });
    return { session, created: true };
  });
}

/**
 * Close customer-opened sessions that have had no orders for the configured
 * idle window. A QR peek (or a bot following a link preview) therefore cannot
 * leave a table OCCUPIED indefinitely. Re-checks the session under a row lock
 * so an order that lands mid-sweep is never discarded.
 */
export async function closeIdleCustomerSessions(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - config.CUSTOMER_SESSION_IDLE_TIMEOUT_MS);
  const systemUser = await prisma.user.findUnique({
    where: { email: SELF_SERVICE_EMAIL },
    select: { id: true },
  });
  if (!systemUser) return 0;

  const candidates = await prisma.diningSession.findMany({
    where: {
      status: "ACTIVE",
      openedBy: systemUser.id,
      openedAt: { lt: cutoff },
      orders: { none: {} },
    },
    select: { id: true, tableId: true },
  });

  let closed = 0;
  for (const candidate of candidates) {
    const didClose = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; openedAt: Date }>>`
        SELECT id, status, "openedAt" FROM "DiningSession"
        WHERE id = ${candidate.id}::uuid
        FOR UPDATE
      `;
      const session = rows[0];
      if (!session || session.status !== "ACTIVE") return false;
      if (new Date(session.openedAt) >= cutoff) return false;
      const orderCount = await tx.order.count({ where: { sessionId: candidate.id } });
      if (orderCount > 0) return false;

      await tx.diningSession.update({
        where: { id: candidate.id },
        data: { status: "CLOSED", closedAt: now },
      });
      await tx.cafeTable.update({ where: { id: candidate.tableId }, data: { status: "AVAILABLE" } });
      await tx.auditLog.create({
        data: {
          actorId: systemUser.id,
          action: "SESSION_AUTO_CLOSED",
          entityType: "DiningSession",
          entityId: candidate.id,
          metadata: { tableId: candidate.tableId, reason: "idle_no_orders" },
        },
      });
      return true;
    });
    if (didClose) closed += 1;
  }
  return closed;
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
