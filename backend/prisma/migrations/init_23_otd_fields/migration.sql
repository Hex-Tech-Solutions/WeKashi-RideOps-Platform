-- Add facility to users (supervisor's client/campus code e.g. "msi-MBlr")
ALTER TABLE users ADD COLUMN IF NOT EXISTS facility VARCHAR(100);

-- Add grace_period_secs to office_locations (default 600 = 10 min)
ALTER TABLE office_locations ADD COLUMN IF NOT EXISTS grace_period_secs INTEGER NOT NULL DEFAULT 600;
