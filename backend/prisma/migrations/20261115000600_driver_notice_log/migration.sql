-- Driver notices that must be sent only once per event (pack-expiry reminders).
-- `ref` identifies the event, e.g. '<packId>:7' = the 7-day reminder for a pack.
-- Additive only.
CREATE TABLE IF NOT EXISTS driver_notice_log (
  id        TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL,
  kind      TEXT NOT NULL,
  ref       TEXT NOT NULL,
  sent_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS driver_notice_log_kind_ref_key ON driver_notice_log (kind, ref);
CREATE INDEX IF NOT EXISTS driver_notice_log_driver_id_idx ON driver_notice_log (driver_id);
