-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE "UserRole"     AS ENUM ('admin', 'supervisor', 'vendor');
CREATE TYPE "DriverStatus" AS ENUM ('pending', 'active', 'blacklisted', 'expired');
CREATE TYPE "KycStatus"    AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE "RideType"     AS ENUM ('login', 'logout', 'scheduled');
CREATE TYPE "RideStatus"   AS ENUM ('pending', 'broadcasting', 'assigned', 'in_progress', 'completed', 'cancelled', 'expired');
CREATE TYPE "OfferResponse" AS ENUM ('pending', 'accepted', 'rejected', 'expired');
CREATE TYPE "PayoutStatus" AS ENUM ('pending', 'paid');

-- ─── users ────────────────────────────────────────────────────────────────────

CREATE TABLE "users" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "email"         TEXT        NOT NULL,
  "password_hash" TEXT        NOT NULL,
  "role"          "UserRole"  NOT NULL,
  "full_name"     TEXT        NOT NULL,
  "org"           TEXT,
  "is_active"     BOOLEAN     NOT NULL DEFAULT true,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- ─── vendors ──────────────────────────────────────────────────────────────────

CREATE TABLE "vendors" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "name"          TEXT        NOT NULL,
  "contact_name"  TEXT        NOT NULL,
  "contact_phone" TEXT        NOT NULL,
  "contact_email" TEXT        NOT NULL,
  "payout_details" JSONB,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "user_id"       TEXT        NOT NULL,

  CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vendors_user_id_key" ON "vendors"("user_id");

-- ─── vehicles ─────────────────────────────────────────────────────────────────

CREATE TABLE "vehicles" (
  "id"        TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "vendor_id" TEXT        NOT NULL,
  "reg_no"    TEXT        NOT NULL,
  "capacity"  INTEGER     NOT NULL,
  "fuel_type" TEXT        NOT NULL,
  "documents" JSONB       NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "vehicles_reg_no_key" ON "vehicles"("reg_no");
CREATE INDEX "vehicles_vendor_id_idx" ON "vehicles"("vendor_id");

-- ─── drivers ──────────────────────────────────────────────────────────────────

CREATE TABLE "drivers" (
  "id"               TEXT           NOT NULL DEFAULT gen_random_uuid()::text,
  "phone"            TEXT           NOT NULL,
  "full_name"        TEXT           NOT NULL,
  "vendor_id"        TEXT           NOT NULL,
  "status"           "DriverStatus" NOT NULL DEFAULT 'pending',
  "kyc_status"       "KycStatus"    NOT NULL DEFAULT 'pending',
  "current_location" geography(Point, 4326),
  "is_online"        BOOLEAN        NOT NULL DEFAULT false,
  "rating"           DOUBLE PRECISION NOT NULL DEFAULT 5.0,
  "vehicle_id"       TEXT,
  "created_at"       TIMESTAMPTZ    NOT NULL DEFAULT now(),

  CONSTRAINT "drivers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "drivers_phone_key" ON "drivers"("phone");
CREATE INDEX "drivers_vendor_id_idx"       ON "drivers"("vendor_id");
CREATE INDEX "drivers_is_online_status_idx" ON "drivers"("is_online", "status");

-- ─── driver_otps ──────────────────────────────────────────────────────────────

CREATE TABLE "driver_otps" (
  "phone"         TEXT        NOT NULL,
  "otp_hash"      TEXT        NOT NULL,
  "expires_at"    TIMESTAMPTZ NOT NULL,
  "attempt_count" INTEGER     NOT NULL DEFAULT 0,

  CONSTRAINT "driver_otps_pkey" PRIMARY KEY ("phone")
);

-- ─── refresh_tokens ───────────────────────────────────────────────────────────

CREATE TABLE "refresh_tokens" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id"    TEXT,
  "driver_id"  TEXT,
  "token_hash" TEXT        NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "revoked_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "refresh_tokens_user_id_idx"   ON "refresh_tokens"("user_id");
CREATE INDEX "refresh_tokens_driver_id_idx" ON "refresh_tokens"("driver_id");
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- ─── employees ────────────────────────────────────────────────────────────────

CREATE TABLE "employees" (
  "id"              TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "supervisor_id"   TEXT        NOT NULL,
  "emp_id"          TEXT        NOT NULL,
  "name"            TEXT        NOT NULL,
  "gender"          TEXT        NOT NULL,
  "phone"           TEXT,
  "pickup_location" geography(Point, 4326) NOT NULL,
  "drop_location"   geography(Point, 4326) NOT NULL,
  "pickup_address"  TEXT        NOT NULL,
  "drop_address"    TEXT        NOT NULL,
  "shift_start"     TEXT        NOT NULL,
  "shift_end"       TEXT        NOT NULL,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "employees_supervisor_id_emp_id_key" ON "employees"("supervisor_id", "emp_id");
CREATE INDEX "employees_supervisor_id_idx" ON "employees"("supervisor_id");

-- ─── rides ────────────────────────────────────────────────────────────────────

CREATE TABLE "rides" (
  "id"                   TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
  "type"                 "RideType"   NOT NULL,
  "status"               "RideStatus" NOT NULL DEFAULT 'pending',
  "supervisor_id"        TEXT         NOT NULL,
  "driver_id"            TEXT,
  "vendor_id"            TEXT,
  "pickup_point"         geography(Point, 4326) NOT NULL,
  "drop_point"           geography(Point, 4326) NOT NULL,
  "pickup_address"       TEXT         NOT NULL,
  "drop_address"         TEXT         NOT NULL,
  "route_polyline"       TEXT,
  "distance_km"          DOUBLE PRECISION,
  "price"                DOUBLE PRECISION,
  "pax_count"            INTEGER      NOT NULL,
  "capacity"             INTEGER      NOT NULL,
  "scheduled_for"        TIMESTAMPTZ,
  "broadcast_started_at" TIMESTAMPTZ,
  "broadcast_expires_at" TIMESTAMPTZ,
  "created_at"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "completed_at"         TIMESTAMPTZ,

  CONSTRAINT "rides_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "rides_supervisor_id_idx"              ON "rides"("supervisor_id");
CREATE INDEX "rides_driver_id_idx"                  ON "rides"("driver_id");
CREATE INDEX "rides_vendor_id_idx"                  ON "rides"("vendor_id");
CREATE INDEX "rides_status_idx"                     ON "rides"("status");
CREATE INDEX "rides_status_broadcast_expires_at_idx" ON "rides"("status", "broadcast_expires_at");

-- ─── ride_employees ───────────────────────────────────────────────────────────

CREATE TABLE "ride_employees" (
  "ride_id"     TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,

  CONSTRAINT "ride_employees_pkey" PRIMARY KEY ("ride_id", "employee_id")
);

-- ─── ride_offers ──────────────────────────────────────────────────────────────

CREATE TABLE "ride_offers" (
  "ride_id"    TEXT           NOT NULL,
  "driver_id"  TEXT           NOT NULL,
  "offered_at" TIMESTAMPTZ    NOT NULL DEFAULT now(),
  "response"   "OfferResponse" NOT NULL DEFAULT 'pending',

  CONSTRAINT "ride_offers_pkey" PRIMARY KEY ("ride_id", "driver_id")
);
CREATE INDEX "ride_offers_ride_id_idx"   ON "ride_offers"("ride_id");
CREATE INDEX "ride_offers_driver_id_idx" ON "ride_offers"("driver_id");

-- ─── payouts ──────────────────────────────────────────────────────────────────

CREATE TABLE "payouts" (
  "id"         TEXT          NOT NULL DEFAULT gen_random_uuid()::text,
  "vendor_id"  TEXT          NOT NULL,
  "period"     TEXT          NOT NULL,
  "amount"     DOUBLE PRECISION NOT NULL,
  "status"     "PayoutStatus" NOT NULL DEFAULT 'pending',
  "paid_at"    TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ   NOT NULL DEFAULT now(),

  CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payouts_vendor_id_idx" ON "payouts"("vendor_id");

-- ─── safety_incidents ─────────────────────────────────────────────────────────

CREATE TABLE "safety_incidents" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "ride_id"     TEXT        NOT NULL,
  "reported_by" TEXT        NOT NULL,
  "description" TEXT        NOT NULL,
  "status"      TEXT        NOT NULL DEFAULT 'open',
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "safety_incidents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "safety_incidents_ride_id_idx" ON "safety_incidents"("ride_id");

-- ─── Foreign keys ─────────────────────────────────────────────────────────────

ALTER TABLE "vendors"
  ADD CONSTRAINT "vendors_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicles"
  ADD CONSTRAINT "vehicles_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "drivers"
  ADD CONSTRAINT "drivers_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "drivers_vehicle_id_fkey"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "refresh_tokens_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_supervisor_id_fkey"
    FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "rides"
  ADD CONSTRAINT "rides_supervisor_id_fkey"
    FOREIGN KEY ("supervisor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "rides_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "rides_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ride_employees"
  ADD CONSTRAINT "ride_employees_ride_id_fkey"
    FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ride_employees_employee_id_fkey"
    FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ride_offers"
  ADD CONSTRAINT "ride_offers_ride_id_fkey"
    FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ride_offers_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payouts"
  ADD CONSTRAINT "payouts_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "safety_incidents"
  ADD CONSTRAINT "safety_incidents_ride_id_fkey"
    FOREIGN KEY ("ride_id") REFERENCES "rides"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── GIST spatial indexes ─────────────────────────────────────────────────────

CREATE INDEX "drivers_current_location_gist"   ON "drivers"   USING GIST ("current_location");
CREATE INDEX "employees_pickup_location_gist"  ON "employees" USING GIST ("pickup_location");
CREATE INDEX "employees_drop_location_gist"    ON "employees" USING GIST ("drop_location");
CREATE INDEX "rides_pickup_point_gist"         ON "rides"     USING GIST ("pickup_point");
CREATE INDEX "rides_drop_point_gist"           ON "rides"     USING GIST ("drop_point");
