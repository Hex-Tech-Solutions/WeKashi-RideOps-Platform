-- Switch pack purchases from Razorpay to Cashfree: make the PackOrder gateway
-- columns provider-neutral. Safe rename — no pack orders exist in production
-- yet. Guarded so it is idempotent on already-renamed databases.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pack_orders' AND column_name='razorpay_order_id'
  ) THEN
    ALTER TABLE "pack_orders" RENAME COLUMN "razorpay_order_id" TO "gateway_order_id";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pack_orders' AND column_name='razorpay_payment_id'
  ) THEN
    ALTER TABLE "pack_orders" RENAME COLUMN "razorpay_payment_id" TO "gateway_payment_id";
  END IF;
END $$;

-- Keep the unique-index name in sync (rename if the old one exists).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='pack_orders_razorpay_order_id_key') THEN
    ALTER INDEX "pack_orders_razorpay_order_id_key" RENAME TO "pack_orders_gateway_order_id_key";
  END IF;
END $$;
