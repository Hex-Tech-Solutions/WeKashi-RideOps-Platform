-- Add is_ac flag to rides so the driver's offer card can show AC vs Non-AC.
-- The ₹100 AC surcharge is already baked into `price`; this column just records
-- the choice so it can be displayed. Defaults false for all existing rows.
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "is_ac" BOOLEAN NOT NULL DEFAULT false;
