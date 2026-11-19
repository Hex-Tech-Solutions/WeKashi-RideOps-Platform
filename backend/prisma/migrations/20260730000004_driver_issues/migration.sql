-- Supervisor-raised issues about drivers (visible to the vendor + admin).
CREATE TABLE "driver_issues" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "supervisor_id" TEXT        NOT NULL,
  "driver_id"     TEXT        NOT NULL,
  "vendor_id"     TEXT        NOT NULL,
  "description"   TEXT        NOT NULL,
  "status"        TEXT        NOT NULL DEFAULT 'open',
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "driver_issues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "driver_issues_vendor_id_idx"     ON "driver_issues"("vendor_id");
CREATE INDEX "driver_issues_supervisor_id_idx" ON "driver_issues"("supervisor_id");

ALTER TABLE "driver_issues"
  ADD CONSTRAINT "driver_issues_supervisor_id_fkey"
    FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_issues_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "driver_issues_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
