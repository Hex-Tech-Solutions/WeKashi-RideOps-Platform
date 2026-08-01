-- Remove Razorpay Route fields from drivers (no longer needed)
ALTER TABLE "drivers"
  DROP COLUMN IF EXISTS "razorpay_account_id",
  DROP COLUMN IF EXISTS "razorpay_account_verified";

-- Create payout_transactions table for RazorpayX Payouts
CREATE TABLE IF NOT EXISTS "payout_transactions" (
  "id"                  TEXT         NOT NULL,
  "driver_id"           TEXT         NOT NULL,
  "amount"              DOUBLE PRECISION NOT NULL,
  "fee"                 DOUBLE PRECISION NOT NULL DEFAULT 5.90,
  "total_deducted"      DOUBLE PRECISION NOT NULL,
  "mode"                TEXT         NOT NULL,
  "status"              TEXT         NOT NULL DEFAULT 'processing',
  "razorpay_payout_id"  TEXT,
  "utr"                 TEXT,
  "narration"           TEXT,
  "idempotency_key"     TEXT         NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payout_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payout_transactions_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "payout_transactions_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "payout_transactions_driver_id_idx"
  ON "payout_transactions"("driver_id");

CREATE INDEX IF NOT EXISTS "payout_transactions_driver_id_status_idx"
  ON "payout_transactions"("driver_id", "status");
