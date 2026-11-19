-- Chat messages on a driver issue (supervisor + vendor + admin).
CREATE TABLE "issue_messages" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "issue_id"    TEXT        NOT NULL,
  "sender_id"   TEXT        NOT NULL,
  "sender_role" TEXT        NOT NULL,
  "sender_name" TEXT        NOT NULL,
  "body"        TEXT        NOT NULL,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "issue_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "issue_messages_issue_id_idx" ON "issue_messages"("issue_id");

ALTER TABLE "issue_messages"
  ADD CONSTRAINT "issue_messages_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "driver_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
