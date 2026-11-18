-- Phase 2: rules accepted on every go-online, automatic face check.
-- Additive only (plus one NOT NULL relaxed), so it is safe on existing data.

-- When the driver last accepted the Rules & Regulations (on tapping Online).
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS rules_accepted_at TIMESTAMP(3);
-- When the driver agreed to the face check (one-time consent screen).
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS face_consent_at TIMESTAMP(3);
-- The last passed face check is good until this time (2 hours, never past
-- midnight IST). NULL = no valid check.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS face_check_valid_until TIMESTAMP(3);

-- One row per face-check attempt. The selfie file is deleted after 30 days
-- (selfie_url set to NULL); the result row stays.
CREATE TABLE IF NOT EXISTS driver_face_checks (
  id          TEXT PRIMARY KEY,
  driver_id   TEXT NOT NULL,
  passed      BOOLEAN NOT NULL,
  reason      TEXT,
  similarity  DOUBLE PRECISION,
  selfie_url  TEXT,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS driver_face_checks_driver_id_created_at_idx ON driver_face_checks (driver_id, created_at);
CREATE INDEX IF NOT EXISTS driver_face_checks_created_at_idx ON driver_face_checks (created_at);

-- A face-mismatch flag has no second account.
ALTER TABLE identity_flags ALTER COLUMN other_driver_id DROP NOT NULL;
