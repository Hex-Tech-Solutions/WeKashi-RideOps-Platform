-- Rentals: supervisor books a Sedan/SUV rental for a named customer; it
-- broadcasts fleet-wide to eligible opted-in drivers. Plus the driver opt-in flag.

ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "rental_opt_in" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "rentals" (
  "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "supervisor_id"   TEXT NOT NULL,
  "driver_id"       TEXT,
  "customer_name"   TEXT NOT NULL,
  "customer_phone"  TEXT NOT NULL,
  "vehicle_type"    TEXT NOT NULL,
  "package_key"     TEXT NOT NULL,
  "hours"           INTEGER NOT NULL,
  "km"              INTEGER NOT NULL,
  "base_price"      DOUBLE PRECISION NOT NULL,
  "extra_per_km"    DOUBLE PRECISION NOT NULL,
  "extra_per_hr"    DOUBLE PRECISION NOT NULL,
  "pickup_address"  TEXT NOT NULL,
  "pickup_point"    geography(Point, 4326),
  "scheduled_for"   TIMESTAMP(3),
  "status"          TEXT NOT NULL DEFAULT 'broadcasting',
  "credit_consumed" BOOLEAN NOT NULL DEFAULT false,
  "notes"           TEXT,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "accepted_at"     TIMESTAMP(3),
  "completed_at"    TIMESTAMP(3),
  CONSTRAINT "rentals_supervisor_id_fkey" FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rentals_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "rentals_status_idx" ON "rentals"("status");
CREATE INDEX IF NOT EXISTS "rentals_driver_id_idx" ON "rentals"("driver_id");
CREATE INDEX IF NOT EXISTS "rentals_supervisor_id_idx" ON "rentals"("supervisor_id");
