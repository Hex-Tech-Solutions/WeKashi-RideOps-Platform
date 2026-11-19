-- Restore ride payment columns removed in init_25 by mistake.
-- These are required for the supervisor → driver payment flow:
--   payment_status: unpaid | paid (supervisor pays driver after ride completion)
--   razorpay_order_id: Razorpay order reference when supervisor initiates payment
--   razorpay_payment_id: populated on payment success
--   paid_at: timestamp when supervisor completed the payment

ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_status     VARCHAR(20) NOT NULL DEFAULT 'unpaid';
ALTER TABLE rides ADD COLUMN IF NOT EXISTS razorpay_order_id  TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS paid_at            TIMESTAMPTZ;
