-- Driver KYC / vehicle documents (files stored on the api disk volume).
CREATE TABLE "driver_documents" (
  "id"         TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "driver_id"  TEXT        NOT NULL,
  "type"       TEXT        NOT NULL,
  "file_url"   TEXT        NOT NULL,
  "number"     TEXT,
  "expiry"     TIMESTAMPTZ,
  "status"     TEXT        NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "driver_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "driver_documents_driver_id_idx" ON "driver_documents"("driver_id");

ALTER TABLE "driver_documents"
  ADD CONSTRAINT "driver_documents_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
