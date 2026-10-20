-- Driver presence heartbeat. `location_updated_at` is stamped on every GPS flush
-- while the driver is online (see locationBuffer.ts). The broadcast sweeper flips
-- `is_online = false` when this timestamp goes stale (> 3 min), so a driver whose
-- app was swiped away, crashed, lost signal, or ran out of battery can no longer
-- linger as a "ghost-online" driver that pollutes matching and the live map.
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "location_updated_at" TIMESTAMP;

-- Supports the sweeper's `WHERE is_online = true AND location_updated_at < NOW() - INTERVAL`.
CREATE INDEX IF NOT EXISTS "drivers_is_online_location_updated_at_idx"
  ON "drivers" ("is_online", "location_updated_at");
