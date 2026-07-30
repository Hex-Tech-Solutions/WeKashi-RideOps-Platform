-- Create office_locations table for supervisors to store multiple office locations
CREATE TABLE "office_locations" (
  "id"           TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "supervisor_id" TEXT       NOT NULL,
  "name"         TEXT        NOT NULL,
  "address"      TEXT        NOT NULL,
  "lat"          DOUBLE PRECISION NOT NULL,
  "lng"          DOUBLE PRECISION NOT NULL,
  "is_default"   BOOLEAN     NOT NULL DEFAULT false,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "office_locations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "office_locations_supervisor_id_idx" ON "office_locations"("supervisor_id");

ALTER TABLE "office_locations"
  ADD CONSTRAINT "office_locations_supervisor_id_fkey"
    FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
