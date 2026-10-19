-- Rentals use the same direct-UPI receipt flow as rides: the supervisor records
-- the last 4 digits of the UTR when paying, and the driver confirms receipt.
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "payment_ref" TEXT;
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "payment_received_at" TIMESTAMP(3);
