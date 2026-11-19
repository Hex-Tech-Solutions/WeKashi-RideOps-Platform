-- Add platform fee and total amount to rides
ALTER TABLE rides ADD COLUMN IF NOT EXISTS platform_fee  NUMERIC(10,2) DEFAULT 20;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS total_amount  NUMERIC(10,2);

-- Driver bank/UPI details for payouts
-- Note: drivers.id is TEXT (not UUID) in this DB
CREATE TABLE IF NOT EXISTS driver_bank_details (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  driver_id    TEXT NOT NULL UNIQUE REFERENCES drivers(id) ON DELETE CASCADE,
  upi_id       TEXT,
  account_no   TEXT,
  ifsc         TEXT,
  account_name TEXT,
  verified     BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
