import { prisma } from "../lib/prisma.js";
import { NotFoundError } from "../lib/errors.js";

export async function getSettings() {
  let settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  if (!settings) {
    settings = await prisma.settings.create({ data: { id: "singleton" } });
  }
  return settings;
}

export async function updateSettings(data: Partial<{
  cafeName: string;
  currency: string;
  taxRateBps: number;
  serviceChargeBps: number;
  roundingEnabled: boolean;
}>) {
  await getSettings();
  return prisma.settings.update({ where: { id: "singleton" }, data });
}

export async function getPublicMenu() {
  const categories = await prisma.menuCategory.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    include: {
      items: {
        where: { isAvailable: true },
        orderBy: { sortOrder: "asc" },
        include: {
          variants: { where: { isActive: true } },
          addons: { where: { isActive: true } },
        },
      },
    },
  });
  return categories;
}

export async function resolveTableByCode(qrToken: string) {
  const table = await prisma.cafeTable.findUnique({
    where: { qrToken },
    include: {
      sessions: {
        where: { status: { in: ["ACTIVE", "BILL_REQUESTED", "PAYMENT_PENDING"] } },
        orderBy: { openedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!table || !table.isActive) throw new NotFoundError("Table not found");
  const activeSession = table.sessions[0] ?? null;
  return { table, activeSession };
}

export async function assertActiveSessionByTableCode(qrToken: string) {
  const { table, activeSession } = await resolveTableByCode(qrToken);
  return { table, session: activeSession };
}
