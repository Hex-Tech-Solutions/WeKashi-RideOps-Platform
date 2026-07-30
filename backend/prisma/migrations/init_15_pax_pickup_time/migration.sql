-- Add scheduled pickup time per passenger (HH:MM string, set by supervisor)
ALTER TABLE "ride_pax" ADD COLUMN "scheduled_pickup_time" TEXT;
