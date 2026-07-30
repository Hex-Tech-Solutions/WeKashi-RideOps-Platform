-- Remove unused Razorpay / ride-payment columns from rides table.
-- Platform is free for supervisors and drivers.
-- Vendor payouts (separate table) are unaffected.
ALTER TABLE rides DROP COLUMN IF EXISTS payment_status;
ALTER TABLE rides DROP COLUMN IF EXISTS razorpay_order_id;
ALTER TABLE rides DROP COLUMN IF EXISTS razorpay_payment_id;
ALTER TABLE rides DROP COLUMN IF EXISTS paid_at;
