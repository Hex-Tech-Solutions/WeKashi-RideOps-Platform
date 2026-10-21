-- Estimated road toll (₹) for a ride, from Google Routes API at booking time.
-- Baked into total_amount as a pass-through cost; stored separately so the
-- supervisor/driver can see the "Toll Charges" line and for audit.
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "toll_charge" DOUBLE PRECISION;
