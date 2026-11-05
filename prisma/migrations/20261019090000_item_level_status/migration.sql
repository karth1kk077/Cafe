-- Item-level preparation tracking (spec 7.2, 10.8, 10.9, 11.1, 11.2).
-- Replaces order-level status transitions with per-line-item states plus a
-- derived order summary.

-- 1. New per-item status enum.
CREATE TYPE "OrderItemStatus" AS ENUM ('QUEUED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');

-- 2. New OrderItem columns.
ALTER TABLE "OrderItem"
    ADD COLUMN "status" "OrderItemStatus" NOT NULL DEFAULT 'QUEUED',
    ADD COLUMN "preparingAt" TIMESTAMP(3),
    ADD COLUMN "readyAt" TIMESTAMP(3),
    ADD COLUMN "servedAt" TIMESTAMP(3),
    ADD COLUMN "cancelledAt" TIMESTAMP(3),
    ADD COLUMN "cancelReason" TEXT,
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill item state from the parent order's legacy status, BEFORE the order
-- status enum is remapped. There is no data loss if the legacy value is unknown.
UPDATE "OrderItem" oi
SET "status" = (
    CASE o."status"::text
        WHEN 'PENDING' THEN 'QUEUED'
        WHEN 'ACCEPTED' THEN 'QUEUED'
        WHEN 'PREPARING' THEN 'PREPARING'
        WHEN 'READY' THEN 'READY'
        WHEN 'SERVED' THEN 'SERVED'
        WHEN 'CANCELLED' THEN 'CANCELLED'
        ELSE 'QUEUED'
    END
)::"OrderItemStatus"
FROM "Order" o
WHERE oi."orderId" = o.id;

-- Drop the transitional default so the column matches the Prisma schema exactly.
ALTER TABLE "OrderItem" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- 3. Remap the OrderStatus enum from the legacy transition states to the
--    derived-summary states defined by the spec.
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
CREATE TYPE "OrderStatus" AS ENUM ('RECEIVED', 'IN_PROGRESS', 'PARTIALLY_READY', 'READY', 'COMPLETED', 'CANCELLED');

ALTER TABLE "Order" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus" USING (
    CASE "status"::text
        WHEN 'PENDING' THEN 'RECEIVED'
        WHEN 'ACCEPTED' THEN 'RECEIVED'
        WHEN 'PREPARING' THEN 'IN_PROGRESS'
        WHEN 'READY' THEN 'READY'
        WHEN 'SERVED' THEN 'COMPLETED'
        WHEN 'CANCELLED' THEN 'CANCELLED'
        ELSE 'RECEIVED'
    END
)::"OrderStatus";
ALTER TABLE "Order" ALTER COLUMN "status" SET DEFAULT 'RECEIVED';

ALTER TABLE "OrderStatusHistory" ALTER COLUMN "toStatus" TYPE "OrderStatus" USING (
    CASE "toStatus"::text
        WHEN 'PENDING' THEN 'RECEIVED'
        WHEN 'ACCEPTED' THEN 'RECEIVED'
        WHEN 'PREPARING' THEN 'IN_PROGRESS'
        WHEN 'READY' THEN 'READY'
        WHEN 'SERVED' THEN 'COMPLETED'
        WHEN 'CANCELLED' THEN 'CANCELLED'
        ELSE 'RECEIVED'
    END
)::"OrderStatus";

ALTER TABLE "OrderStatusHistory" ALTER COLUMN "fromStatus" TYPE "OrderStatus" USING (
    CASE
        WHEN "fromStatus" IS NULL THEN NULL
        ELSE (
            CASE "fromStatus"::text
                WHEN 'PENDING' THEN 'RECEIVED'
                WHEN 'ACCEPTED' THEN 'RECEIVED'
                WHEN 'PREPARING' THEN 'IN_PROGRESS'
                WHEN 'READY' THEN 'READY'
                WHEN 'SERVED' THEN 'COMPLETED'
                WHEN 'CANCELLED' THEN 'CANCELLED'
                ELSE 'RECEIVED'
            END
        )::"OrderStatus"
    END
);

DROP TYPE "OrderStatus_old";

-- 4. Per-item audit trail.
CREATE TABLE "OrderItemEvent" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderItemStatus",
    "toStatus" "OrderItemStatus" NOT NULL,
    "actorId" UUID,
    "source" TEXT NOT NULL DEFAULT 'STAFF',
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderItemEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrderItemEvent_orderItemId_createdAt_idx" ON "OrderItemEvent"("orderItemId", "createdAt");
CREATE INDEX "OrderItemEvent_orderId_idx" ON "OrderItemEvent"("orderId");
CREATE INDEX "OrderItem_status_updatedAt_idx" ON "OrderItem"("status", "updatedAt");

ALTER TABLE "OrderItemEvent"
    ADD CONSTRAINT "OrderItemEvent_orderItemId_fkey" FOREIGN KEY ("orderItemId")
    REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderItemEvent" ADD CONSTRAINT "OrderItemEvent_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Race-free human-readable order/bill numbers (replaces count()+1 generation).
CREATE SEQUENCE IF NOT EXISTS "cafe_order_number_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "cafe_bill_number_seq" START 1;
