-- Backfill OTPs for rentals created before OTP generation existed. Any rental
-- still live (not completed/cancelled) with a NULL pickup/drop OTP gets a fresh
-- 4-digit code so the supervisor's Rental Ride card can show it.
UPDATE "rentals"
SET "pickup_otp" = LPAD((floor(random() * 9000) + 1000)::int::text, 4, '0')
WHERE "pickup_otp" IS NULL;

UPDATE "rentals"
SET "drop_otp" = LPAD((floor(random() * 9000) + 1000)::int::text, 4, '0')
WHERE "drop_otp" IS NULL;
