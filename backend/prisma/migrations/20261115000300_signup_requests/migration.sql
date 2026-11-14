-- Driver sign-up becomes a request the vendor approves (no OTP until approved).
-- Additive only; existing rows are left as they are (signup_source stays NULL,
-- so the 7-day expiry never touches them).
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS signup_source TEXT;

-- The vehicle row is created at sign-up with only its registration number;
-- seats and fuel are filled in later from the driver's Vehicle info.
ALTER TABLE vehicles ALTER COLUMN capacity DROP NOT NULL;
ALTER TABLE vehicles ALTER COLUMN fuel_type DROP NOT NULL;
