-- Create route_templates table for saving reusable employee groups
CREATE TABLE "route_templates" (
  "id"                   TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "supervisor_id"        TEXT        NOT NULL,
  "name"                 TEXT        NOT NULL,
  "ride_type"            TEXT        NOT NULL,
  "vehicle_type"         TEXT,
  "office_location_id"   TEXT,
  "ordered_employee_ids" JSONB       NOT NULL DEFAULT '[]',
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "last_used_at"         TIMESTAMPTZ,

  CONSTRAINT "route_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "route_templates_supervisor_id_idx" ON "route_templates"("supervisor_id");

ALTER TABLE "route_templates"
  ADD CONSTRAINT "route_templates_supervisor_id_fkey"
    FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "route_templates"
  ADD CONSTRAINT "route_templates_office_location_id_fkey"
    FOREIGN KEY ("office_location_id") REFERENCES "office_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
