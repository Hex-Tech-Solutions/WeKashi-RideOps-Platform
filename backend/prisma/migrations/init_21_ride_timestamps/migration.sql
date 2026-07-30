-- Add accepted_at and started_at timestamps to rides
ALTER TABLE rides ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS started_at  TIMESTAMPTZ;
