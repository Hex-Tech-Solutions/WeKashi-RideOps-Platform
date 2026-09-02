-- Manual fare top-up the supervisor adds at booking time (e.g. +50/+75/+100/+125/+150),
-- already included in `price`. Stored separately so the adjustment amount can be
-- shown/audited without recomputing it from distance/vehicle each time.
-- IF NOT EXISTS so this is safe to re-run on an environment where the column
-- was already created under a different migration name. The sibling migrations
-- in this batch are all idempotent; this one was not, and it failed with
-- 42701 (column already exists) on the dev box, blocking every later migration.
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "fare_adjustment" DOUBLE PRECISION DEFAULT 0;
