-- Store GPS breadcrumbs while a ride is in_progress so the actual route
-- taken by the driver can be replayed on the completed-ride detail view.
CREATE TABLE "ride_location_logs" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "ride_id"    TEXT        NOT NULL,
  "driver_id"  TEXT        NOT NULL,
  "lat"        DOUBLE PRECISION NOT NULL,
  "lng"        DOUBLE PRECISION NOT NULL,
  "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "ride_location_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ride_location_logs_ride_id_idx"      ON "ride_location_logs"("ride_id");
CREATE INDEX "ride_location_logs_ride_recorded_idx" ON "ride_location_logs"("ride_id", "recorded_at");

ALTER TABLE "ride_location_logs"
  ADD CONSTRAINT "ride_location_logs_ride_id_fkey"
    FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ride_location_logs"
  ADD CONSTRAINT "ride_location_logs_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
