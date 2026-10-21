-- Airport rides: a single-passenger point-to-point airport transfer booked by a
-- supervisor, reusing the rides table. 'airport' is added to RideType. The
-- passenger is entered manually (no employee link, no ride_pax rows); the
-- pickup/drop OTPs live on the ride and are relayed verbally by the supervisor,
-- mirroring the escort-OTP pattern. Fare is per-km (no bands/minimum) + toll.

ALTER TYPE "RideType" ADD VALUE IF NOT EXISTS 'airport';

ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "airport_direction" TEXT;   -- to_airport | from_airport
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "airport_terminal"  TEXT;   -- T1 | T2
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "pax_name"          TEXT;
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "pax_phone"         TEXT;
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "flight_number"     TEXT;
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "airport_pickup_otp" TEXT;
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "airport_drop_otp"   TEXT;
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "airport_pickup_at"  TIMESTAMP;
ALTER TABLE "rides" ADD COLUMN IF NOT EXISTS "airport_drop_at"    TIMESTAMP;
