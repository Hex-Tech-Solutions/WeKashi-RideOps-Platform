-- Supervisor's company office location (set via Google Maps).
ALTER TABLE "users" ADD COLUMN "office_lat" DOUBLE PRECISION;
ALTER TABLE "users" ADD COLUMN "office_lng" DOUBLE PRECISION;
ALTER TABLE "users" ADD COLUMN "office_address" TEXT;
