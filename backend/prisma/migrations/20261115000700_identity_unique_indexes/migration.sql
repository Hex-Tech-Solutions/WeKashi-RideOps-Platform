-- Database-level uniqueness for driver identity (the final guard behind the
-- application checks in backend/src/lib/identity.ts).
--
--   login phone   last 10 digits       alt phone   last 10 digits
--   driving licence  letters+digits    Aadhaar     keyed hash (gov_id_hash)
--   UPI ID        lower-case
--
-- Each index covers every live account: status NOT IN ('removed','rejected').
-- Blacklisted / expired accounts keep their details reserved, same as the app.
-- (drivers.phone already has a plain UNIQUE constraint and vehicles.reg_no is
-- UNIQUE too; the phone index below also catches differently formatted copies.)
--
-- SAFE TO RUN ON EXISTING DATA. The API runs `prisma migrate deploy` on every
-- boot, so a failing migration would stop the API from starting. Each index is
-- therefore created in two steps:
--   1. the full index over all live accounts;
--   2. if existing (test) rows already hold a duplicate, the same index limited
--      to accounts created from this moment on, so every NEW account is
--      protected and no existing row is touched or rejected.
-- Which variant each index got:  SELECT indexname, indexdef FROM pg_indexes
--   WHERE indexname LIKE 'drivers\_%\_uniq';   (the fallback mentions created_at)
--
-- To undo: DROP INDEX drivers_phone_last10_uniq, drivers_alt_phone_last10_uniq,
--   drivers_dl_number_norm_uniq, drivers_gov_id_hash_uniq, drivers_upi_vpa_norm_uniq;

DO $mig$
DECLARE
  spec   RECORD;
  cutoff TEXT := NOW()::timestamp::text;
  live   TEXT := $c$status NOT IN ('removed', 'rejected')$c$;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('drivers_phone_last10_uniq',
       $e$right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)$e$,
       $p$phone IS NOT NULL AND phone <> ''$p$),
      ('drivers_alt_phone_last10_uniq',
       $e$right(regexp_replace(alt_phone, '[^0-9]', '', 'g'), 10)$e$,
       $p$alt_phone IS NOT NULL AND alt_phone <> ''$p$),
      ('drivers_dl_number_norm_uniq',
       $e$upper(regexp_replace(dl_number, '[^A-Za-z0-9]', '', 'g'))$e$,
       $p$dl_number IS NOT NULL AND dl_number <> ''$p$),
      ('drivers_gov_id_hash_uniq',
       $e$gov_id_hash$e$,
       $p$gov_id_hash IS NOT NULL AND gov_id_hash <> ''$p$),
      ('drivers_upi_vpa_norm_uniq',
       $e$lower(upi_vpa)$e$,
       $p$upi_vpa IS NOT NULL AND upi_vpa <> ''$p$)
    ) AS t(idx, expr, extra)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = spec.idx) THEN
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('CREATE UNIQUE INDEX %I ON drivers ((%s)) WHERE %s AND %s',
                     spec.idx, spec.expr, live, spec.extra);
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'Existing duplicates for %: created the index for accounts created from now on only', spec.idx;
      EXECUTE format('CREATE UNIQUE INDEX %I ON drivers ((%s)) WHERE %s AND %s AND created_at >= %L::timestamp',
                     spec.idx, spec.expr, live, spec.extra, cutoff);
    END;
  END LOOP;
END
$mig$;
