-- Audit trail for driver wallet penalties. Fines were previously applied as a
-- bare walletBalance decrement with no record, leaving disputes unresolvable.
CREATE TABLE "driver_fines" (
  "id"         TEXT NOT NULL,
  "driver_id"  TEXT NOT NULL,
  "ride_id"    TEXT,
  "amount"     DOUBLE PRECISION NOT NULL,
  "reason"     TEXT NOT NULL,
  "notes"      TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "driver_fines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "driver_fines_driver_id_idx" ON "driver_fines"("driver_id");
CREATE INDEX "driver_fines_driver_id_created_at_idx" ON "driver_fines"("driver_id", "created_at");

ALTER TABLE "driver_fines"
  ADD CONSTRAINT "driver_fines_driver_id_fkey"
  FOREIGN KEY ("driver_id") REFERENCES "drivers"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
