-- Add women's safety escort fields to rides table
ALTER TABLE "rides"
  ADD COLUMN IF NOT EXISTS "escort_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "escort_name"     TEXT;
