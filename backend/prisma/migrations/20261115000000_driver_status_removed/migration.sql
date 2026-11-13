-- A vendor/admin-deleted driver account. Kept for history; identity released.
-- (Own migration: a new enum value can't be used in the same transaction.)
ALTER TYPE "DriverStatus" ADD VALUE IF NOT EXISTS 'removed';
