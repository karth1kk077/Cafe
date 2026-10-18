import { prisma } from "../lib/prisma.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { sumMinor } from "../lib/money.js";
import { getSettings } from "./menuService.js";

async function generateBillNumber(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  const count = await tx.bill.count();
  const seq = String(count + 1).padStart(6, "0");
  return `BILL-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${seq}`;
}

// Build an immutable billing snapshot from all non-cancelled orders in the session.
export async function generateBill(sessionId: string, actor: { id: string }) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.diningSession.findUnique({
      where: { id: sessionId },
      include: {
        orders: { where: { status: { notIn: ["CANCELLED"] } }, include: { items: true } },
      },
    });
    if (!session) throw new NotFoundError("Session not found");

    const existingOpen = await tx.bill.findFirst({
      where: { sessionId, status: { in: ["OPEN", "PARTIAL"] } },
    });
    if (existingOpen) {
      return tx.bill.findUnique({
        where: { id: existingOpen.id },
        include: { lineItems: true, payments: true },
      });
    }

    if (!session.orders.length) throw new ConflictError("No billable orders in session", "EMPTY_SESSION");

    const settings = await getSettings();
    let subtotal = 0;
    const lines: Array<{
      orderId: string;
      nameSnapshot: string;
      quantity: number;
      unitPriceMinor: number;
      lineTotalMinor: number;
    }> = [];

    for (const order of session.orders) {
      for (const item of order.items) {
        subtotal += item.lineTotalMinor;
        lines.push({
          orderId: order.id,
          nameSnapshot: item.nameSnapshot,
          quantity: item.quantity,
          unitPriceMinor: item.unitPriceMinor,
          lineTotalMinor: item.lineTotalMinor,
        });
      }
    }

    const taxMinor = Math.round((subtotal * settings.taxRateBps) / 10000);
    const serviceChargeMinor = Math.round((subtotal * settings.serviceChargeBps) / 10000);
    const preRounding = sumMinor([subtotal, taxMinor, serviceChargeMinor]);
    const roundingMinor = settings.roundingEnabled ? Math.round(preRounding / 100) * 100 - preRounding : 0;
    const totalMinor = preRounding + roundingMinor;

    const billNumber = await generateBillNumber(tx);
    const bill = await tx.bill.create({
      data: {
        billNumber,
        sessionId,
        tableId: session.tableId,
        status: "OPEN",
        subtotalMinor: subtotal,
        taxMinor,
        serviceChargeMinor,
        discountMinor: 0,
        roundingMinor,
        totalMinor,
        currency: settings.currency,
        lineItems: { create: lines.map((l) => ({ ...l, currency: settings.currency })) },
      },
      include: { lineItems: true, payments: true },
    });

    await tx.diningSession.update({ where: { id: sessionId }, data: { status: "PAYMENT_PENDING" } });
    await tx.cafeTable.update({ where: { id: session.tableId }, data: { status: "PAYMENT_PENDING" } });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "BILL_GENERATED",
        entityType: "Bill",
        entityId: bill.id,
        metadata: { totalMinor, billNumber },
      },
    });
    return bill;
  });
}

export async function recordPayment(
  input: { billId: string; amountMinor: number; method: "CASH" | "OTHER"; reference?: string },
  actor: { id: string }
) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findUnique({
      where: { id: input.billId },
      include: { payments: true },
    });
    if (!bill) throw new NotFoundError("Bill not found");
    if (bill.status === "PAID") throw new ConflictError("Bill already paid", "ALREADY_PAID");

    // Lock the bill row to serialize concurrent payments.
    await tx.$queryRaw`SELECT id FROM "Bill" WHERE id = ${input.billId}::uuid FOR UPDATE`;
    const fresh = await tx.bill.findUnique({ where: { id: input.billId }, include: { payments: true } });
    if (!fresh) throw new NotFoundError("Bill not found");

    const paidSoFar = fresh.payments
      .filter((p) => p.status === "COMPLETED")
      .reduce((a, p) => a + p.amountMinor, 0);

    if (paidSoFar + input.amountMinor > fresh.totalMinor) {
      throw new ConflictError("Payment exceeds bill total", "OVERPAYMENT");
    }

    const payment = await tx.payment.create({
      data: {
        billId: input.billId,
        amountMinor: input.amountMinor,
        method: input.method,
        reference: input.reference ?? null,
        status: "COMPLETED",
        recordedBy: actor.id,
      },
    });

    const newPaid = paidSoFar + input.amountMinor;
    const newStatus = newPaid >= fresh.totalMinor ? "PAID" : "PARTIAL";
    await tx.bill.update({ where: { id: input.billId }, data: { status: newStatus } });

    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "PAYMENT_RECORDED",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { billId: input.billId, amountMinor: input.amountMinor, method: input.method },
      },
    });

    return { payment, bill: await tx.bill.findUnique({ where: { id: input.billId }, include: { payments: true } }) };
  });
}
