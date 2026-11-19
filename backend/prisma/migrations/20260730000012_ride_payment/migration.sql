-- Razorpay payment tracking on a ride (supervisor pays the fare).
ALTER TABLE "rides" ADD COLUMN "payment_status" TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE "rides" ADD COLUMN "razorpay_order_id" TEXT;
ALTER TABLE "rides" ADD COLUMN "razorpay_payment_id" TEXT;
ALTER TABLE "rides" ADD COLUMN "paid_at" TIMESTAMP(3);
