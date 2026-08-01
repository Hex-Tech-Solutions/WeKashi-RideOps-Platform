CREATE INDEX IF NOT EXISTS "rides_supervisor_id_payment_status_idx"
  ON "rides"("supervisor_id", "payment_status");
