import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding sample café...");

  const passwordHash = await bcrypt.hash("Password123!", 12);

  // Staff accounts
  const admin = await prisma.user.upsert({
    where: { email: "admin@cafe.local" },
    update: {},
    create: {
      email: "admin@cafe.local",
      name: "Ada Admin",
      role: "ADMIN",
      passwordHash,
    },
  });
  const waiter = await prisma.user.upsert({
    where: { email: "waiter@cafe.local" },
    update: {},
    create: {
      email: "waiter@cafe.local",
      name: "Walter Waiter",
      role: "WAITER",
      passwordHash,
    },
  });
  const chef = await prisma.user.upsert({
    where: { email: "chef@cafe.local" },
    update: {},
    create: {
      email: "chef@cafe.local",
      name: "Charlie Chef",
      role: "KITCHEN",
      passwordHash,
    },
  });
  console.log("Users:", admin.email, waiter.email, chef.email);

  // Settings
  await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton", cafeName: "Smart Café", currency: "INR", taxRateBps: 500, serviceChargeBps: 0 },
  });

  // Tables
  const tableNumbers = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
  const tables = [];
  for (const number of tableNumbers) {
    const qrToken =
      randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const table = await prisma.cafeTable.upsert({
      where: { number },
      update: {},
      create: { number, qrToken, seats: 4 },
    });
    tables.push(table);
  }
  console.log("Tables:", tables.length);

  // Categories
  const coffeeCat = await prisma.menuCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Coffee",
      description: "Freshly brewed",
      sortOrder: 1,
    },
  });
  const foodCat = await prisma.menuCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000002" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Food",
      description: "Light bites",
      sortOrder: 2,
    },
  });
  const dessertCat = await prisma.menuCategory.upsert({
    where: { id: "00000000-0000-4000-8000-000000000003" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000003",
      name: "Desserts",
      description: "Sweet treats",
      sortOrder: 3,
    },
  });

  // Coffee items
  const espresso = await prisma.menuItem.upsert({
    where: { id: "10000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "10000000-0000-4000-8000-000000000001",
      categoryId: coffeeCat.id,
      name: "Espresso",
      description: "Rich single shot",
      priceMinor: 12000,
      dietaryTags: ["vegan"],
      allergens: [],
    },
  });
  const latte = await prisma.menuItem.upsert({
    where: { id: "10000000-0000-4000-8000-000000000002" },
    update: {},
    create: {
      id: "10000000-0000-4000-8000-000000000002",
      categoryId: coffeeCat.id,
      name: "Caffè Latte",
      description: "Smooth espresso with steamed milk",
      priceMinor: 18000,
      allergens: ["milk"],
    },
  });
  await prisma.menuItemVariant.upsert({
    where: { id: "20000000-0000-4000-8000-000000000001" },
    update: {},
    create: { id: "20000000-0000-4000-8000-000000000001", menuItemId: latte.id, name: "Small", priceDeltaMinor: 0 },
  });
  await prisma.menuItemVariant.upsert({
    where: { id: "20000000-0000-4000-8000-000000000002" },
    update: {},
    create: { id: "20000000-0000-4000-8000-000000000002", menuItemId: latte.id, name: "Large", priceDeltaMinor: 4000 },
  });
  await prisma.menuItemAddon.upsert({
    where: { id: "30000000-0000-4000-8000-000000000001" },
    update: {},
    create: { id: "30000000-0000-4000-8000-000000000001", menuItemId: latte.id, name: "Extra Shot", priceMinor: 3000 },
  });

  // Food items
  const grilledSandwich = await prisma.menuItem.upsert({
    where: { id: "10000000-0000-4000-8000-000000000003" },
    update: {},
    create: {
      id: "10000000-0000-4000-8000-000000000003",
      categoryId: foodCat.id,
      name: "Grilled Sandwich",
      description: "Toasted with cheese and veggies",
      priceMinor: 15000,
      allergens: ["gluten", "milk"],
    },
  });
  await prisma.menuItem.upsert({
    where: { id: "10000000-0000-4000-8000-000000000004" },
    update: {},
    create: {
      id: "10000000-0000-4000-8000-000000000004",
      categoryId: foodCat.id,
      name: "Veg Salad Bowl",
      description: "Fresh greens and veggies",
      priceMinor: 22000,
      dietaryTags: ["vegan", "gluten-free"],
      allergens: [],
    },
  });

  // Desserts
  await prisma.menuItem.upsert({
    where: { id: "10000000-0000-4000-8000-000000000005" },
    update: {},
    create: {
      id: "10000000-0000-4000-8000-000000000005",
      categoryId: dessertCat.id,
      name: "Chocolate Brownie",
      description: "Warm with a fudgy center",
      priceMinor: 16000,
      allergens: ["gluten", "milk", "egg"],
    },
  });

  console.log("Menu seeded. Coffee, Food, Desserts.");
  console.log("Sample QR tokens for tables 1-10:");
  for (const t of tables) {
    console.log(`  Table ${t.number}: /t/${t.qrToken}`);
  }
  console.log("Staff logins (password: Password123!): admin@cafe.local, waiter@cafe.local, chef@cafe.local");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
