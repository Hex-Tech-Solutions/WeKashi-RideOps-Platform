-- Customer no-show on a rental: the driver closes it, it is marked completed and
-- billed at half the base price (to compensate the driver for showing up), and
-- this flag records that it was a no-show so the supervisor card + history can
-- label it distinctly.
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "no_show" BOOLEAN NOT NULL DEFAULT false;
