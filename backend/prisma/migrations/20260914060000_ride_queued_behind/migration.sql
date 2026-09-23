-- Next-ride queueing: a driver finishing a ride can accept a new broadcast that
-- is held as a queued ride until the current ride completes. A queued ride is
-- status='assigned' with queued_behind_ride_id pointing at the active ride.
-- Additive + idempotent; all existing rows are NULL (no queued rides).

ALTER TABLE "rides"
  ADD COLUMN IF NOT EXISTS "queued_behind_ride_id" TEXT;

CREATE INDEX IF NOT EXISTS "rides_driver_id_queued_behind_ride_id_idx"
  ON "rides"("driver_id", "queued_behind_ride_id");
