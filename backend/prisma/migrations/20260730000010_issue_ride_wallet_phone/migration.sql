-- Issue → ride link, ride claim timestamp (3h fine grace), supervisor phone (female POC).
ALTER TABLE "driver_issues" ADD COLUMN "ride_id" TEXT;
ALTER TABLE "driver_issues"
  ADD CONSTRAINT "driver_issues_ride_id_fkey"
    FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rides" ADD COLUMN "claimed_at" TIMESTAMPTZ;

ALTER TABLE "users" ADD COLUMN "phone" TEXT;
