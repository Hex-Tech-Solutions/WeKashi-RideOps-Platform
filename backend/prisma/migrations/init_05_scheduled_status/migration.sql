-- New ride status for the scheduled-rides marketplace.
ALTER TYPE "RideStatus" ADD VALUE IF NOT EXISTS 'scheduled';
