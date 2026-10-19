-- Rental Rides: live lifecycle for an accepted rental — arrival, pickup OTP,
-- in-progress timer + GPS distance tracking, overage billing, drop OTP.
-- OTPs are auto-generated at booking and shown only on the supervisor's card.

ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "pickup_otp"         TEXT;
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "drop_otp"           TEXT;
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "overage_agreed"     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "distance_m"         DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "overage_hours"      DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "overage_km"         DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "overage_amount"     DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "total_amount"       DOUBLE PRECISION;
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "arrived_at"         TIMESTAMP(3);
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "started_at"         TIMESTAMP(3);
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "overage_started_at" TIMESTAMP(3);

-- Per-rental GPS breadcrumb trail (the odometer source). Mirrors
-- ride_location_logs but keyed to a rental.
CREATE TABLE IF NOT EXISTS "rental_location_logs" (
  "id"         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "rental_id"  TEXT NOT NULL,
  "point"      geography(Point, 4326) NOT NULL,
  "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rental_location_logs_rental_id_fkey" FOREIGN KEY ("rental_id") REFERENCES "rentals"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "rental_location_logs_rental_id_idx" ON "rental_location_logs"("rental_id", "recorded_at");
