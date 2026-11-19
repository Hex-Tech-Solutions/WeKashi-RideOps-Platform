-- Per-ride rate on payouts (pending payouts recompute amount from live ride count).
ALTER TABLE "payouts" ADD COLUMN "rate_per_ride" DOUBLE PRECISION;
-- Optional uploaded invoice/proof file attached to a payout.
ALTER TABLE "payouts" ADD COLUMN "file_url" TEXT;
