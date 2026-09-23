-- Drop the dead ride-payment Razorpay columns. These were written by the old
-- supervisor-pays-via-Razorpay /confirm flow, which was removed when supervisor
-- → driver payment became a direct off-platform UPI transfer. Nothing reads or
-- writes them anymore. `payment_status` is kept (drives the supervisor's
-- pending-payments list).

ALTER TABLE "rides" DROP COLUMN IF EXISTS "razorpay_order_id";
ALTER TABLE "rides" DROP COLUMN IF EXISTS "razorpay_payment_id";
ALTER TABLE "rides" DROP COLUMN IF EXISTS "paid_at";
