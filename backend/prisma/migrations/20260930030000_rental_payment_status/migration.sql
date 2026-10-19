-- Rentals participate in the direct-UPI payment flow like normal rides: a
-- completed rental is "unpaid" until the supervisor pays the driver.
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "payment_status" TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3);
