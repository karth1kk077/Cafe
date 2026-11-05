-- Customer-requested dining sessions.
--
-- A table QR scan may ask to start a session without a staff member present.
-- Such a session is created in PENDING: the menu is browsable, but no customer
-- token is minted and no order can be placed until a waiter confirms it.
ALTER TYPE "SessionStatus" ADD VALUE IF NOT EXISTS 'PENDING' BEFORE 'ACTIVE';

-- A PENDING session has no staff opener yet; it is stamped when confirmed.
ALTER TABLE "DiningSession" ALTER COLUMN "openedBy" DROP NOT NULL;

-- Optional UPI VPA for one-tap customer payment deep links.
ALTER TABLE "Settings" ADD COLUMN IF NOT EXISTS "upiId" TEXT;
