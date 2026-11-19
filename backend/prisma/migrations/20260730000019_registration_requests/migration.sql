-- Self-service account registration requests (vendor / supervisor → admin review)
CREATE TABLE "registration_requests" (
  "id"            TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "role"          TEXT        NOT NULL,
  "full_name"     TEXT        NOT NULL,
  "email"         TEXT        NOT NULL,
  "password_hash" TEXT        NOT NULL,
  "mobile"        TEXT        NOT NULL,
  "company_name"  TEXT        NOT NULL,
  "gstin"         TEXT,
  "address"       TEXT        NOT NULL,
  "status"        TEXT        NOT NULL DEFAULT 'pending',
  "review_note"   TEXT,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "reviewed_at"   TIMESTAMPTZ,

  CONSTRAINT "registration_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "registration_requests_email_key" ON "registration_requests"("email");
CREATE INDEX "registration_requests_status_idx" ON "registration_requests"("status");
