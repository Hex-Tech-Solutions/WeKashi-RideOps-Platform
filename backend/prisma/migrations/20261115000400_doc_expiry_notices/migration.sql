-- Document expiry reminders (#13). One row per document per reminder step
-- (30 / 15 / 7 / 1 days before expiry, 0 = expired) so each reminder is sent
-- at most once. Additive only.
CREATE TABLE IF NOT EXISTS doc_expiry_notices (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  driver_id   TEXT NOT NULL,
  threshold   INTEGER NOT NULL,
  sent_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS doc_expiry_notices_document_id_threshold_key
  ON doc_expiry_notices (document_id, threshold);
CREATE INDEX IF NOT EXISTS doc_expiry_notices_driver_id_idx ON doc_expiry_notices (driver_id);
