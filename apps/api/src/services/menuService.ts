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
  upiId: string | null;
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
        // Unavailable items stay visible so the customer sees an explicit
        // "Unavailable" state instead of the menu shifting under them.
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

/** Full menu for the admin editor, including inactive categories/items. */
export async function getAdminMenu() {
  return prisma.menuCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      items: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          variants: { orderBy: { name: "asc" } },
          addons: { orderBy: { name: "asc" } },
        },
      },
    },
  });
}

export async function resolveTableByCode(qrToken: string) {
  const table = await prisma.cafeTable.findUnique({
    where: { qrToken },
    include: {
      sessions: {
          // PENDING is included so the customer sees "waiting for staff" instead
          // of a Start-ordering button; `canOrder` still requires ACTIVE.
          where: { status: { in: ["PENDING", "ACTIVE", "BILL_REQUESTED", "PAYMENT_PENDING"] } },
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
