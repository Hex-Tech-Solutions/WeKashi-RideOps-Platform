-- Vehicle type + seats for drivers; requested vehicle type on rides.
ALTER TABLE "drivers" ADD COLUMN "vehicle_type" TEXT;
ALTER TABLE "drivers" ADD COLUMN "seats" INTEGER;

ALTER TABLE "rides" ADD COLUMN "vehicle_type" TEXT;

-- Helps the "available vehicle types near pickup" query.
CREATE INDEX "drivers_online_type_idx" ON "drivers"("is_online", "status", "vehicle_type");
