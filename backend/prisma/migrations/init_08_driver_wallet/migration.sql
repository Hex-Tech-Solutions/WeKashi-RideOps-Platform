-- Driver wallet balance (scheduled-ride cancellation fines deduct from here).
ALTER TABLE "drivers" ADD COLUMN "wallet_balance" DOUBLE PRECISION NOT NULL DEFAULT 0;
