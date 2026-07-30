-- Cancellation fee on rides (5% of fare when cancelling an assigned ride)
ALTER TABLE rides ADD COLUMN IF NOT EXISTS cancellation_fee NUMERIC(10,2);

-- Pending cancellation fee accumulator on supervisors (billed on next booking)
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_cancellation_fee NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Razorpay Route linked account fields on drivers
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS razorpay_account_id       TEXT;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS razorpay_account_verified  BOOLEAN NOT NULL DEFAULT false;
