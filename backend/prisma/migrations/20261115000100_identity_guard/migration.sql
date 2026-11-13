-- Zero-tolerance duplicate accounts (see backend/src/lib/identity.ts).
-- Additive only: existing (test) rows are left exactly as they are. The
-- database UNIQUE indexes on normalised identity columns are added in the
-- fresh-start migration, once the test data has been cleared.

-- Keyed hash of the Aadhaar for duplicate matching (full number never stored).
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS gov_id_hash TEXT;
-- When the vendor/admin deleted the account.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS removed_at TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS drivers_gov_id_hash_idx ON drivers (gov_id_hash);

-- Soft "possible duplicate" signals for admins.
CREATE TABLE IF NOT EXISTS identity_flags (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  driver_id       TEXT NOT NULL,
  other_driver_id TEXT NOT NULL,
  detail          TEXT,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at     TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS identity_flags_resolved_at_idx ON identity_flags (resolved_at);
CREATE INDEX IF NOT EXISTS identity_flags_driver_id_idx ON identity_flags (driver_id);
