-- Driver-side acknowledgment of a direct UPI payment. The supervisor records
-- the last-4 UTR (payment_ref); the driver, after matching it against their
-- bank credit, marks the ride as received (payment_received_at).

ALTER TABLE "rides"
  ADD COLUMN IF NOT EXISTS "payment_received_at" TIMESTAMP(3);
