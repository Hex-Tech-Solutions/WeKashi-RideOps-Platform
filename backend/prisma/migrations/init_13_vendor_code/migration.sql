-- Add vendor_code column to vendors table.
-- Step 1: add as nullable first so existing rows don't violate NOT NULL.
ALTER TABLE "vendors" ADD COLUMN "vendor_code" TEXT;

-- Step 2: backfill existing vendors with a unique code (VND- + 6 uppercase hex chars).
UPDATE "vendors"
SET "vendor_code" = 'VND-' || UPPER(SUBSTRING(MD5(id::text || RANDOM()::text) FOR 6))
WHERE "vendor_code" IS NULL;

-- Step 3: make the column NOT NULL and add the unique constraint.
ALTER TABLE "vendors" ALTER COLUMN "vendor_code" SET NOT NULL;
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_vendor_code_key" UNIQUE ("vendor_code");
