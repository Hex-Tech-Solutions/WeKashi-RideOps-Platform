-- Add SOS fields to driver_issues table
ALTER TABLE "driver_issues" ADD COLUMN "issue_type" TEXT;
ALTER TABLE "driver_issues" ADD COLUMN "is_sos" BOOLEAN NOT NULL DEFAULT false;
