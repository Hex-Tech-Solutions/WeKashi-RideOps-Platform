-- Driver-subscription-payments: additive migration.
-- Adds the credit-ledger tables, driver UPI fields, and the ride credit-burn
-- idempotency flag. No destructive drops here — wallet/fine/payout columns and
-- tables are removed in a later migration after archival is verified.

-- ── Driver: direct-payment UPI + joining-bonus guard ─────────────────────────
ALTER TABLE "drivers"
  ADD COLUMN IF NOT EXISTS "upi_vpa" TEXT,
  ADD COLUMN IF NOT EXISTS "upi_vpa_name" TEXT,
  ADD COLUMN IF NOT EXISTS "upi_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "joining_bonus_granted_at" TIMESTAMP(3);

-- ── Ride: credit-burn idempotency flag ───────────────────────────────────────
ALTER TABLE "rides"
  ADD COLUMN IF NOT EXISTS "credit_consumed" BOOLEAN NOT NULL DEFAULT false;

-- ── Credit_Ledger: one row per pack a driver holds ───────────────────────────
CREATE TABLE IF NOT EXISTS "credit_packs" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "credits_total" INTEGER NOT NULL,
    "credits_remaining" INTEGER NOT NULL,
    "price_paid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pack_order_id" TEXT,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "credit_packs_pkey" PRIMARY KEY ("id")
);

-- ── Pack_Payment_Service order records ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS "pack_orders" (
    "id" TEXT NOT NULL,
    "driver_id" TEXT NOT NULL,
    "pack_key" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "razorpay_order_id" TEXT NOT NULL,
    "razorpay_payment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "activated_pack_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),
    CONSTRAINT "pack_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "credit_packs_driver_id_status_expires_at_created_at_idx"
  ON "credit_packs"("driver_id", "status", "expires_at", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "pack_orders_razorpay_order_id_key"
  ON "pack_orders"("razorpay_order_id");

CREATE INDEX IF NOT EXISTS "pack_orders_driver_id_idx"
  ON "pack_orders"("driver_id");

ALTER TABLE "credit_packs"
  ADD CONSTRAINT "credit_packs_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "credit_packs"
  ADD CONSTRAINT "credit_packs_pack_order_id_fkey"
  FOREIGN KEY ("pack_order_id") REFERENCES "pack_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pack_orders"
  ADD CONSTRAINT "pack_orders_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
