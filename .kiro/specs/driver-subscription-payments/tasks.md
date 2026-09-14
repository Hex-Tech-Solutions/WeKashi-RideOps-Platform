# Implementation Plan

## Overview

This plan implements the driver-subscription-payments overhaul. Tasks are ordered so the schema and shared libs land first, then the credit ledger + payment services, then ride/broadcast wiring, then routes, migrations, and finally the frontend. Each task is independently testable and cites the requirements it satisfies.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "3", "3.1", "7"] },
    { "wave": 2, "tasks": ["4"] },
    { "wave": 3, "tasks": ["4.1", "5", "6"] },
    { "wave": 4, "tasks": ["5.1", "8", "9"] },
    { "wave": 5, "tasks": ["10", "11", "12", "13"] },
    { "wave": 6, "tasks": ["14"] },
    { "wave": 7, "tasks": ["14.1", "15", "16"] },
    { "wave": 8, "tasks": ["17"] }
  ],
  "dependencies": {
    "4": ["1", "2", "3"],
    "4.1": ["4"],
    "5": ["3", "4"],
    "5.1": ["5"],
    "6": ["3"],
    "8": ["4", "7"],
    "9": ["4"],
    "10": ["5", "6", "8", "9"],
    "11": ["5"],
    "12": ["6", "8"],
    "13": ["5"],
    "14": ["2"],
    "14.1": ["14"],
    "15": ["10", "12"],
    "16": ["12"],
    "17": ["14.1", "15", "16"]
  }
}
```

## Tasks

- [x] 1. Add the pack catalog constant module
  - Create `backend/src/lib/creditPacks.ts` exporting `PACK_VALIDITY_DAYS = 365`, `JOINING_BONUS_CREDITS = 1`, and `PACK_CATALOG` with `p5` (5/₹100), `p10` (10/₹159), `p20` (20/₹249), plus a `PackKey` type.
  - Add a unit test asserting the three packs, prices, and validity.
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 2. Schema: additive changes (credit tables, driver UPI fields, ride credit flag)
  - Edit `backend/prisma/schema.prisma`: add `CreditPack` and `PackOrder` models per the design; add `Driver.upiVpa`, `upiVpaName`, `upiVerified`, `joiningBonusGrantedAt` and the `creditPacks` / `packOrders` relations; add `Ride.creditConsumed`.
  - Keep existing wallet/fine/payout fields for now (removed in a later destructive migration).
  - Generate the additive migration and run `prisma generate`.
  - _Requirements: 6.5, 7.3, 8.1, 8.2, 10.1, 13.2_

- [x] 3. Razorpay client wrapper
  - Create `backend/src/lib/razorpay.ts` using the installed `razorpay` SDK: `createPackOrder`, `verifyPaymentSignature` (HMAC-SHA256), `validateVpa`, and a `verifyWebhookSignature` helper. Read `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` from env.
  - Unit test signature verify (valid/invalid) with a mocked secret.
  - _Requirements: 6.1, 6.4, 13.1_

- [x] 3.1 Backend env wiring
  - Add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` to `backend/.env.example` with placeholder values and a comment.
  - _Requirements: 6.1_

- [x] 4. Credit_Ledger service
  - Create `backend/src/services/creditPack.service.ts` with `availableCredits`, `listPacks` (lazy-expire on read), `grantJoiningBonus` (guarded by `joiningBonusGrantedAt`), `activatePurchasedPack`, and `consumeOneCredit` (atomic, oldest-expiring-first, idempotent via `Ride.creditConsumed`, `FOR UPDATE SKIP LOCKED`).
  - _Requirements: 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 9.1, 9.2, 9.3, 10.1, 10.2, 10.5_

- [x] 4.1 Credit ledger unit tests
  - Test oldest-first consumption, equal-expiry tiebreak burns exactly one, expired/exhausted packs excluded from `availableCredits`, `grantJoiningBonus` runs once.
  - _Requirements: 8.3, 9.3, 10.2, 10.5, 7.3_

- [x] 5. Pack_Payment_Service
  - Create `backend/src/services/packOrder.service.ts`: `createOrder(driverId, packKey)` (creates Razorpay order + `PackOrder` row), and `activateFromPayment({ orderId, paymentId, signature })` — verify signature, then run the idempotent activation transaction guarded by `PackOrder.activatedPackId` that calls `creditPack.activatePurchasedPack`. Expose an internal `activateFromWebhook` path reusing the same guarded activation.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 5.1 Pack payment idempotency tests
  - Test: valid signature activates once; second call (webhook) is a no-op; invalid signature adds no credits and marks order failed.
  - _Requirements: 6.4, 6.6_

- [x] 6. VPA validation service
  - Create `backend/src/services/vpa.service.ts`: `saveAndValidateVpa(driverId, vpa)` calls `razorpay.validateVpa`; on success persist `upiVpa`/`upiVpaName`/`upiVerified=true`; on failure store nothing and throw a descriptive error.
  - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 7. Pricing lib: remove fees and fine policy
  - Edit `backend/src/lib/pricing.ts`: remove `PLATFORM_FEE`, `releaseFine`, `ReleaseFineOutcome`, `RELEASE_*`, `SCHEDULED_NO_SHOW_FINE`, `DRIVER_DROP_AFTER_ARRIVAL_FINE`. Keep `computeFare`, `escortCharge`, `MINIMUM_FARE`, slabs.
  - Update any imports that referenced the removed symbols.
  - _Requirements: 1.4, 12.1_

- [x] 8. Ride service: drop fines/fees, gate accept, burn credit on complete
  - Edit `backend/src/services/ride.service.ts`: remove `driver_fines` writes and wallet debits on drop/release/no-show; remove `pendingCancellationFee` and `platformFee` from creation/cancellation; compute supervisor total = `price + escortCharge`; in the accept path re-check `availableCredits >= 1` (throw `ForbiddenError` if 0); on transition to `completed` call `consumeOneCredit` in the same transaction; never consume on cancel/no-show/expire.
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.1, 2.2, 2.3, 10.1, 10.3, 10.4, 11.2, 11.4, 12.1, 12.2_

- [x] 9. Driver service + broadcast: gate on credits, grant bonus on onboarding
  - Edit `backend/src/services/driver.service.ts`: add the credit `EXISTS` gate to `findNearbyDrivers` (and any nearby-for-ride query); call `grantJoiningBonus` when a driver is onboarded/activated. Confirm `broadcastSweeper.ts` re-includes drivers once they buy a pack.
  - _Requirements: 7.1, 11.1, 11.2, 11.3, 11.5_

- [x] 10. Driver routes: credits, packs, UPI; remove wallet/withdraw/payout
  - Edit `backend/src/routes/driver.ts`: add `GET /driver/packs/catalog`, `GET /driver/credits`, `POST /driver/packs/order`, `POST /driver/packs/verify`, `POST /driver/upi`. Remove wallet fields from `GET /driver/me`, remove `/driver/wallet`, `/driver/withdraw`, `/driver/payouts`, and bank-detail routes (rewrote `payments.ts` to the new model).
  - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 6.1, 6.2, 8.3, 13.1, 13.4_

- [x] 11. Razorpay webhook route
  - Add `POST /payments/webhook` (raw-body, signature-verified) that calls the idempotent activation path. Wired in `app.ts` webhook-path exclusion before JSON body parsing.
  - _Requirements: 6.6_

- [x] 12. Supervisor pay-QR route
  - Add `GET /rides/:id/pay-qr` in `backend/src/routes/rides.ts`: if ride completed and driver `upiVerified`, return `{ upiIntent, payeeName, amount }`; else 409 with a clear message. Never record as a platform transaction.
  - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 13. Admin pack-sales report
  - Add `GET /admin/pack-sales?from&to` (route + `admin.service.packSalesReport`) returning per-purchase rows and aggregates.
  - _Requirements: 15.1, 15.2_

- [x] 14. Data migration (archives + backfill) — folded into SQL for a single-push deploy
  - Archival + joining-bonus backfill now live INSIDE the destructive migration SQL (see 14.1), so `prisma migrate deploy` on container boot does everything atomically with no manual script. The standalone `dataMigrate.ts` was removed. Snapshots non-zero wallet balances + pending fees into archive tables; copies `driver_fines`/`payout_transactions`/`driver_bank_details` into `*_archive` then drops the originals; backfills one `joining_bonus` CreditPack per active driver. Guarded so it is safe on fresh, partially-migrated, or already-archived databases.
  - _Requirements: 1.6, 2.4, 3.4, 4.4, 4.5, 4.6, 7.1_

- [x] 14.1 Destructive migration (archive-then-remove, single transaction)
  - `20260914010000_remove_wallet_fines_fees`: in one transaction — archives data (step 14), backfills bonus packs, then drops `Driver.walletBalance`, `Ride.platformFee`, `Ride.cancellationFee`, `User.pendingCancellationFee` and the legacy tables. If any step fails the whole migration rolls back (no silent data loss) and the deploy aborts on the previous image. Verified end-to-end against the dev DB (columns dropped, archives intact, 3 bonus packs). Schema updated to match; `migrate status` clean.
  - _Requirements: 2.5, 3.2_

- [x] 15. Frontend: driver credits + UPI, remove wallet/withdraw/payout
  - Added `DriverCredits.tsx` (catalog, buy via Razorpay Checkout, per-pack remaining+expiry, 0-credit empty state) and `DriverUpiCard.tsx` (validate + save). Edited `DriverAccountPanel.tsx`/`DriverAccount.tsx` to swap the wallet section for "Ride Credits" + "Payout UPI". Removed `WalletCard`/`WithdrawSection`/`PayoutHistory` and their hooks in `lib/queries.ts`. Removed fine-warning copy from the driver cancel + scheduled-release dialogs.
  - _Requirements: 3.1, 4.1, 4.2, 5.3, 8.3, 11.2, 13.4_

- [x] 16. Frontend: supervisor pay-QR step
  - Rewrote `PayRideDialog.tsx` to fetch `/rides/:id/pay-qr`, render the UPI QR (qrcode.react) + payee name + amount, and handle the 409 "no payable UPI" case. "Mark as paid" is local-only. Updated `Payments.tsx` to drop platform-fee/wallet copy and show UPI status.
  - _Requirements: 14.2, 14.3_

- [x] 17. Full verification pass
  - Backend typecheck clean; new pure-unit + DB-backed credit/ledger/activation tests (18) pass against the migrated DB. Data-migration script verified end-to-end (archives populated, 3 bonus packs backfilled, pending fee cleared). Frontend `tsc -p tsconfig.app.json` clean for all changed files and `vite build` succeeds. Pre-existing unrelated errors remain in `RoleLayout.tsx` and the `createTestVendor` helper.
  - _Requirements: 1.5, 2.2, 10.1, 12.2, 3.4, 4.4_

## Notes

- Follow the rollout order in the design: additive schema + new endpoints first, data-migration script second, destructive drops last. This keeps a rollback from losing data.
- Idempotency guards are load-bearing: `PackOrder.activatedPackId` for activation and `Ride.creditConsumed` for credit burn. Do not weaken them.
- Escort logic, escort OTP, and the ₹500 minimum fare are out of scope and must remain unchanged.
- Backend build/typecheck is clean; new pure-unit + DB-backed credit/pack tests pass. The pre-existing integration suite has an unrelated `createTestVendor` helper bug (missing `vendorCode`).
```
