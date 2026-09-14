-- Driver-subscription-payments: archive-then-remove migration.
--
-- Prisma runs this whole file in a single transaction, so archival, backfill
-- and drops are atomic: if anything fails, NOTHING is dropped and the deploy
-- aborts on the previous image (Req 1.6 / 2.5 / 3.4 / 4.4 / 4.6 — no silent
-- data loss). No manual script is required — everything runs on boot via
-- `prisma migrate deploy`.
--
-- Steps:
--   1. Archive non-zero wallet balances and pending cancellation fees.
--   2. Archive driver_fines / payout_transactions / driver_bank_details
--      (copied into *_archive tables, then the originals are dropped).
--   3. Backfill one joining_bonus credit pack per active driver missing one.
--   4. Drop the deprecated columns.

-- ── 1a. Wallet balance archive ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "wallet_balance_archive" (
  "driver_id"   TEXT NOT NULL,
  "balance"     DOUBLE PRECISION NOT NULL,
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'drivers' AND column_name = 'wallet_balance'
  ) THEN
    INSERT INTO "wallet_balance_archive" ("driver_id", "balance")
    SELECT id, wallet_balance FROM "drivers" WHERE wallet_balance <> 0;
  END IF;
END $$;

-- ── 1b. Pending cancellation fee archive + clear (Req 2.4) ────────────────────
CREATE TABLE IF NOT EXISTS "pending_cancellation_fee_archive" (
  "user_id"     TEXT NOT NULL,
  "amount"      DOUBLE PRECISION NOT NULL,
  "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'pending_cancellation_fee'
  ) THEN
    INSERT INTO "pending_cancellation_fee_archive" ("user_id", "amount")
    SELECT id, pending_cancellation_fee FROM "users" WHERE pending_cancellation_fee <> 0;

    UPDATE "users" SET pending_cancellation_fee = 0 WHERE pending_cancellation_fee <> 0;
  END IF;
END $$;

-- ── 2. Archive fines / payouts / bank details, then drop originals ────────────
-- Copy every row into a *_archive table (CREATE TABLE AS preserves all columns),
-- then drop the source. Guarded so re-runs / partially-migrated DBs are safe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='driver_fines') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='driver_fines_archive') THEN
      CREATE TABLE "driver_fines_archive" AS TABLE "driver_fines";
    END IF;
    DROP TABLE "driver_fines";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payout_transactions') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='payout_transactions_archive') THEN
      CREATE TABLE "payout_transactions_archive" AS TABLE "payout_transactions";
    END IF;
    DROP TABLE "payout_transactions";
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='driver_bank_details') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='driver_bank_details_archive') THEN
      CREATE TABLE "driver_bank_details_archive" AS TABLE "driver_bank_details";
    END IF;
    DROP TABLE "driver_bank_details";
  END IF;
END $$;

-- ── 3. Backfill joining-bonus credit for existing active drivers (Req 7) ──────
-- One free credit so current active drivers aren't locked out the moment the
-- credit gate turns on. Guarded by joining_bonus_granted_at so it grants once.
INSERT INTO "credit_packs"
  (id, driver_id, source, credits_total, credits_remaining, price_paid, activated_at, expires_at, status, created_at)
SELECT
  gen_random_uuid(), d.id, 'joining_bonus', 1, 1, 0,
  NOW(), NOW() + INTERVAL '365 days', 'active', NOW()
FROM "drivers" d
WHERE d.status = 'active'
  AND d.joining_bonus_granted_at IS NULL;

UPDATE "drivers"
SET joining_bonus_granted_at = NOW()
WHERE status = 'active' AND joining_bonus_granted_at IS NULL;

-- ── 4. Drop the deprecated columns ────────────────────────────────────────────
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "wallet_balance";
ALTER TABLE "users"   DROP COLUMN IF EXISTS "pending_cancellation_fee";
ALTER TABLE "rides"   DROP COLUMN IF EXISTS "platform_fee";
ALTER TABLE "rides"   DROP COLUMN IF EXISTS "cancellation_fee";
