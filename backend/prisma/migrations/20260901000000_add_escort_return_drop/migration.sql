-- Escort return-drop verification for logout escort rides.
-- Escort boards at the office with the employees (no pickup OTP needed —
-- supervisor already vouched for them by name). A separate OTP gates the
-- escort's return drop at the office once all employees are dropped, and
-- blocks ride completion until verified. The OTP is never sent to the
-- escort automatically (no phone on file) — the supervisor relays it to
-- the driver directly.
ALTER TABLE "rides" ADD COLUMN "escort_otp" TEXT;
ALTER TABLE "rides" ADD COLUMN "escort_dropped_at" TIMESTAMP(3);
