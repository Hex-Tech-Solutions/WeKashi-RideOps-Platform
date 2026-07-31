-- Add personal/licence details to drivers table
ALTER TABLE "drivers"
  ADD COLUMN IF NOT EXISTS "dl_number"     TEXT,
  ADD COLUMN IF NOT EXISTS "dl_expiry"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gov_id_number" TEXT,
  ADD COLUMN IF NOT EXISTS "alt_phone"     TEXT;

-- Add review fields to driver_documents table
ALTER TABLE "driver_documents"
  ADD COLUMN IF NOT EXISTS "rejection_note" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_by"    TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_at"    TIMESTAMP(3);

-- Add composite index for pending document queries (vendor approval screen)
CREATE INDEX IF NOT EXISTS "driver_documents_driver_id_status_idx"
  ON "driver_documents"("driver_id", "status");
