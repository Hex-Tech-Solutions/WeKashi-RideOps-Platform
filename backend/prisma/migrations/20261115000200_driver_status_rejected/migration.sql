-- A self sign-up request the vendor rejected (or that expired unapproved).
-- Not a blacklist: the details are released so the person can apply again.
ALTER TYPE "DriverStatus" ADD VALUE IF NOT EXISTS 'rejected';
