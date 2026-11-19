-- Add planned_start_time and driver_reporting_time to rides
ALTER TABLE rides ADD COLUMN IF NOT EXISTS planned_start_time    TIMESTAMPTZ;
ALTER TABLE rides ADD COLUMN IF NOT EXISTS driver_reporting_time TIMESTAMPTZ;
