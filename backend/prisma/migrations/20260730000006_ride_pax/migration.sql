-- Per-passenger trip legs with pickup/drop OTPs (OTP trip flow).
CREATE TABLE "ride_pax" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "ride_id"     TEXT        NOT NULL,
  "employee_id" TEXT        NOT NULL,
  "seq"         INTEGER     NOT NULL,
  "pickup_otp"  TEXT        NOT NULL,
  "drop_otp"    TEXT        NOT NULL,
  "picked_at"   TIMESTAMPTZ,
  "dropped_at"  TIMESTAMPTZ,
  "no_show"     BOOLEAN     NOT NULL DEFAULT false,

  CONSTRAINT "ride_pax_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ride_pax_ride_id_idx" ON "ride_pax"("ride_id");

ALTER TABLE "ride_pax"
  ADD CONSTRAINT "ride_pax_ride_id_fkey"
    FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ride_pax_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
