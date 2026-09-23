-- Supervisor marks a direct UPI payment as paid, recording the last 4 digits of
-- the UPI transaction id as a local audit reference. The payment itself is
-- off-platform/untracked; this is bookkeeping only. Re-add paid_at (dropped
-- earlier as a dead Razorpay field) to timestamp the manual mark.

ALTER TABLE "rides"
  ADD COLUMN IF NOT EXISTS "payment_ref" TEXT,
  ADD COLUMN IF NOT EXISTS "paid_at" TIMESTAMP(3);
