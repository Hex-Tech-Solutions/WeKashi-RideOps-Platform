-- GST on credit packs + tax invoices (#5). Additive only: existing (test)
-- orders keep NULL in the new columns and get no invoice.
ALTER TABLE pack_orders ADD COLUMN IF NOT EXISTS base_amount DOUBLE PRECISION;
ALTER TABLE pack_orders ADD COLUMN IF NOT EXISTS gst_amount DOUBLE PRECISION;
ALTER TABLE pack_orders ADD COLUMN IF NOT EXISTS invoice_no TEXT;
ALTER TABLE pack_orders ADD COLUMN IF NOT EXISTS invoice_date TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS pack_orders_invoice_no_key ON pack_orders (invoice_no);

-- Consecutive invoice numbers per financial year (e.g. '2627' = FY 2026-27).
CREATE TABLE IF NOT EXISTS invoice_counters (
  fy   TEXT PRIMARY KEY,
  last INTEGER NOT NULL
);
