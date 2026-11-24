-- Per-stop arrival and no-show time for ride passengers. Additive only; safe on existing data.
ALTER TABLE ride_pax ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMP(3);
ALTER TABLE ride_pax ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMP(3);
