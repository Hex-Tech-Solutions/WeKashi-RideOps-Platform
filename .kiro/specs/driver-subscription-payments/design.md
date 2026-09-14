# Design Document

## Overview

This design implements the driver-subscription-payments overhaul described in `requirements.md`. It replaces the wallet-and-fine economy with a stacking ride-credit subscription model and restructures how supervisors pay drivers.

The change is deliberately split into four cooperating parts that ship together because they share data and money flows:

1. **Fine + cancellation-fee removal** — delete fine calculation, wallet debits, `driver_fines` writes, and the supervisor `pendingCancellationFee`.
2. **Wallet + payout removal** — remove `walletBalance`, the withdraw flow, and payout history (backend + UI), preserving existing balances via an archive table.
3. **Ride-credit packs** — a new `credit_packs` table (one row per purchased/bonus pack) forming the `Credit_Ledger`, plus a `pack_orders` table for Razorpay pack purchases.
4. **Payments restructure** — remove the platform fee from supervisor totals; add Razorpay pack checkout (driver → platform, tracked); add UPI VPA validation + `upi://` QR generation for direct supervisor → driver payment (untracked).

Escort logic, escort OTP, and the ₹500 minimum fare are unchanged.

### Design goals

- **Credit consumption is atomic and idempotent** — exactly one credit burned per completed ride, never on cancel/no-show, never double-burned.
- **Pack activation is idempotent** — a Razorpay order activates its pack once, whether confirmed by the client callback or the webhook.
- **No silent data loss** — production wallet balances, fines, and payouts are archived, not dropped.
- **Backwards-safe rollout** — schema migrations are additive first (add credit tables, archive old data), destructive drops happen only after archival is confirmed.

## Architecture

### Current vs. new money model

```
BEFORE
  Supervisor pays: price + platformFee(₹20) + escort + pendingCancellationFee
  Driver earns:    fare + escort  → credited to Driver.walletBalance
  Driver withdraws: walletBalance → bank/UPI via Razorpay Payout (fee ₹5.90)
  Driver penalised: fines debit walletBalance + write driver_fines

AFTER
  Supervisor pays: price + escort        (no platform fee, no cancellation fee)
  Payment path:    Supervisor → Driver DIRECT via UPI QR (untracked)
  Driver pays us:  buys credit packs via Razorpay (tracked in our account)
  Eligibility:     Driver needs ≥1 available credit to receive/accept broadcasts
  Consumption:     1 credit burned on ride COMPLETE (oldest-expiring pack first)
  No wallet, no fines, no payouts.
```

### Component map

```
backend/src/
  lib/
    pricing.ts            (EDIT) remove PLATFORM_FEE, fines, release policy constants
    razorpay.ts           (NEW)  Razorpay SDK client: orders, signature verify, VPA validate
  services/
    creditPack.service.ts (NEW)  Credit_Ledger: grant, consume, list, expire, availability
    packOrder.service.ts  (NEW)  Pack_Payment_Service: create order, verify, activate (idempotent)
    ride.service.ts       (EDIT) drop fine logic; consume credit on complete; gate accept on credits; drop platform/cancel fee
    driver.service.ts     (EDIT) gate findNearbyDrivers on available credits; grant joining bonus on onboarding
    vpa.service.ts        (NEW)  VPA_Validation_Service: validate + persist verified UPI VPA
  routes/
    driver.ts             (EDIT) + GET /driver/credits, POST /driver/packs/order, POST /driver/packs/verify,
                                  POST /driver/upi (validate+save); remove wallet/withdraw/payout routes
    rides.ts              (EDIT) + GET /rides/:id/pay-qr (supervisor fetches driver UPI QR)
    admin.ts / analytics  (EDIT) + GET pack-sales report
  lib/broadcastSweeper.ts (EDIT) optional: sweep expired packs (or lazy-expire on read)

frontend (src/)
  pages/driver/
    DriverAccount.tsx        (EDIT) remove WalletCard/WithdrawSection/PayoutHistory
    DriverCredits.tsx        (NEW)  buy packs, see remaining credits + per-pack expiry
    DriverUpiCard.tsx        (NEW)  save + validate UPI VPA
    DriverAccountPanel.tsx   (EDIT) swap "Wallet & Ride Earnings" section → "Ride Credits" + "Payout UPI"
  pages/supervisor/
    (payment step)           (EDIT) show driver UPI QR to pay after completion
  lib/queries.ts             (EDIT) new hooks; remove wallet/withdraw/payout hooks
```

## Data Models

### New: `CreditPack` (the Credit_Ledger)

One row per pack a driver holds (purchased or bonus). This is the ledger — total available credits is the sum of `creditsRemaining` across non-expired packs.

```prisma
model CreditPack {
  id               String    @id @default(uuid())
  driverId         String    @map("driver_id")
  source           String    // "purchase" | "joining_bonus"
  creditsTotal     Int       @map("credits_total")      // 1 (bonus), 5, 10, or 20
  creditsRemaining Int       @map("credits_remaining")
  pricePaid        Float     @default(0) @map("price_paid") // 0 for bonus
  packOrderId      String?   @map("pack_order_id")       // FK to PackOrder for purchases
  activatedAt      DateTime  @default(now()) @map("activated_at")
  expiresAt        DateTime  @map("expires_at")          // activatedAt + 365d
  status           String    @default("active")          // active | exhausted | expired
  createdAt        DateTime  @default(now()) @map("created_at")

  driver    Driver     @relation(fields: [driverId], references: [id])
  packOrder PackOrder? @relation(fields: [packOrderId], references: [id])

  // Consuming oldest-expiring-first with a stable tiebreak needs (expiresAt, createdAt).
  @@index([driverId, status, expiresAt, createdAt])
  @@map("credit_packs")
}
```

**Why a row-per-pack (not a single counter):** the requirements demand per-pack expiry, stacking, and oldest-first consumption. A single integer can't express "these 5 expire on Jan 1, those 10 on Feb 3." Each pack is an independent bucket.

**Status semantics:**
- `active` — has remaining credits and not past `expiresAt`.
- `exhausted` — `creditsRemaining` hit 0 

**Validates: Requirements **.
- `expired` — past `expiresAt` 

**Validates: Requirements **.

Both `exhausted` and `expired` are excluded from available-credit math. We keep them distinct for reporting/history.

### New: `PackOrder` (Pack_Payment_Service record)

```prisma
model PackOrder {
  id                String   @id @default(uuid())
  driverId          String   @map("driver_id")
  packKey           String   @map("pack_key")        // "p5" | "p10" | "p20" (catalog key)
  credits           Int
  amount            Float                              // ₹100 / ₹159 / ₹249
  razorpayOrderId   String   @unique @map("razorpay_order_id")
  razorpayPaymentId String?  @map("razorpay_payment_id")
  status            String   @default("created")      // created | paid | failed
  activatedPackId   String?  @map("activated_pack_id") // set once CreditPack created — idempotency guard
  createdAt         DateTime @default(now()) @map("created_at")
  paidAt            DateTime? @map("paid_at")

  driver Driver @relation(fields: [driverId], references: [id])

  @@index([driverId])
  @@map("pack_orders")
}
```

**Idempotency 

**Validates: Requirements **:** `activatedPackId` is the guard. Activation runs in a transaction that (a) re-reads the order `FOR UPDATE`, (b) proceeds only if `status != 'paid'` / `activatedPackId IS NULL`, (c) creates the `CreditPack`, sets `status='paid'`, and stamps `activatedPackId`. The webhook and the client-confirm path both call the same guarded function; whichever arrives second is a no-op.

### Edited: `Driver`

```prisma
model Driver {
  // ...unchanged fields...
  // REMOVE: walletBalance   Float @default(0) @map("wallet_balance")
  // ADD:
  upiVpa           String?  @map("upi_vpa")           // verified UPI VPA for direct payment
  upiVpaName       String?  @map("upi_vpa_name")      // account holder name from VPA validation
  upiVerified      Boolean  @default(false) @map("upi_verified")
  joiningBonusGrantedAt DateTime? @map("joining_bonus_granted_at") // Req 7.3 grant-once guard

  creditPacks      CreditPack[]
  packOrders       PackOrder[]
  // REMOVE relations: payouts, fines
  // KEEP: bankDetail is dropped (see below) — or repurpose upiVpa fields replace it
}
```

The existing `DriverBankDetail` (upiId/accountNo/ifsc) was for withdrawals. We fold the payable-UPI into the `Driver` row (`upiVpa`) since it's a single validated address now. `DriverBankDetail` is archived + dropped.

### Edited: `Ride`

```prisma
model Ride {
  // REMOVE: platformFee, cancellationFee
  // totalAmount recomputed = price + escortCharge
  // ADD:
  creditConsumed   Boolean  @default(false) @map("credit_consumed") // idempotency for credit burn
}
```

`creditConsumed` guarantees Req 10.1's "exactly one credit per completed ride" survives retries / double status transitions.

### Edited: `User`

```prisma
model User {
  // REMOVE: pendingCancellationFee  (archive value first)
}
```

### Archive tables (Data_Migration, Req 1.6 / 3.4 / 4.4)

Rather than dropping data, the migration copies it into `_archive` tables before removing columns/tables:

- `driver_fines` → renamed to `driver_fines_archive` (kept as-is; no new writes).
- `payout_transactions` → renamed to `payout_transactions_archive`.
- `driver_bank_details` → renamed to `driver_bank_details_archive`.
- `wallet_balance_archive` (NEW): `{ driverId, balance, archivedAt }` — snapshot of every non-zero `Driver.walletBalance` before the column drop.
- `pending_cancellation_fee_archive` (NEW): `{ userId, amount, archivedAt }` — snapshot before clearing/dropping.

**Migration ordering 

**Validates: Requirements **:**
1. Additive migration: create `credit_packs`, `pack_orders`, archive tables; add `Driver.upiVpa*`, `Ride.creditConsumed`.
2. Data migration script: snapshot wallet balances + pending fees into archives; backfill one `joining_bonus` `CreditPack` for every existing active driver (so current drivers aren't locked out on deploy).
3. Destructive migration: rename fines/payouts/bank tables to `_archive`; drop `Driver.walletBalance`, `Ride.platformFee`, `Ride.cancellationFee`, `User.pendingCancellationFee`.

Step 3 only runs after step 2 verifies row counts. If the archive step errors, the destructive step does not run 

**Validates: Requirements **.

## Pack Catalog

A backend constant (single source of truth), mirrored to the frontend via a `GET /driver/packs/catalog` endpoint so pricing never diverges.

```ts
// backend/src/lib/creditPacks.ts
export const PACK_VALIDITY_DAYS = 365;
export const JOINING_BONUS_CREDITS = 1;

export const PACK_CATALOG = {
  p5:  { key: 'p5',  credits: 5,  price: 100 },
  p10: { key: 'p10', credits: 10, price: 159 },
  p20: { key: 'p20', credits: 20, price: 249 },
} as const;
export type PackKey = keyof typeof PACK_CATALOG;
```

## Components and Interfaces

This section defines the service interfaces, the Razorpay integration surface, and the HTTP API. The data these components operate on is defined in **Data Models** above.

### Credit_Ledger service (`creditPack.service.ts`)

```ts
// Available credits = sum(creditsRemaining) over packs that are active AND not past expiry.
async function availableCredits(driverId): Promise<number>

// Lazy expiry: on any read, packs past expiresAt are treated as expired
// (and opportunistically marked). A daily sweeper also flips them for reporting.
async function listPacks(driverId): Promise<PackView[]>  // active + expiry per pack

// Grant joining bonus once 

**Validates: Requirements **. Guarded by Driver.joiningBonusGrantedAt.
async function grantJoiningBonus(driverId): Promise<void>

// Activate a purchased pack (called by packOrder.service after payment verified).
async function activatePurchasedPack(driverId, packKey, packOrderId): Promise<CreditPack>

// Consume exactly one credit, oldest-expiring first. Called on ride complete.
async function consumeOneCredit(driverId, rideId): Promise<void>
```

### `consumeOneCredit` 

**Validates: Requirements ** — atomic, oldest-first, idempotent

```ts
await prisma.$transaction(async (tx) => {
  // Idempotency: only burn if this ride hasn't already burned one.
  const ride = await tx.$queryRaw`
    SELECT credit_consumed FROM rides WHERE id = ${rideId} FOR UPDATE`;
  if (ride[0]?.credit_consumed) return;

  // Oldest-expiring active pack with credits left; lock the row.
  const pack = await tx.$queryRaw`
    SELECT id FROM credit_packs
    WHERE driver_id = ${driverId} AND status = 'active'
      AND credits_remaining > 0 AND expires_at > NOW()
    ORDER BY expires_at ASC, created_at ASC
    LIMIT 1 FOR UPDATE SKIP LOCKED`;

  // No credit available: complete the ride anyway 

**Validates: Requirements ** but record nothing burned.
  if (!pack.length) {
    await tx.$executeRaw`UPDATE rides SET credit_consumed = false WHERE id = ${rideId}`;
    return;
  }

  await tx.$executeRaw`
    UPDATE credit_packs
    SET credits_remaining = credits_remaining - 1,
        status = CASE WHEN credits_remaining - 1 <= 0 THEN 'exhausted' ELSE status END
    WHERE id = ${pack[0].id}`;
  await tx.$executeRaw`UPDATE rides SET credit_consumed = true WHERE id = ${rideId}`;
});
```

The `FOR UPDATE` on the ride row + `credit_consumed` flag makes concurrent/retry completions safe. `ORDER BY expires_at, created_at` gives the deterministic oldest-first with a stable tiebreak 

**Validates: Requirements **.

**Where it's called:** in `advanceRideStatus` when transitioning to `completed`, inside the same transaction that stamps `completedAt`. No-show/cancel transitions never call it (Req 10.3/10.4).

## Broadcast eligibility 

**Validates: Requirements **

`findNearbyDrivers` already filters `is_online`, `status='active'`, `kyc_status='approved'`, and excludes drivers on active rides. Add a credit gate via a correlated check:

```sql
-- add to the WHERE clause in findNearbyDrivers and nearbyDriversForRide:
AND EXISTS (
  SELECT 1 FROM credit_packs cp
  WHERE cp.driver_id = drivers.id
    AND cp.status = 'active'
    AND cp.credits_remaining > 0
    AND cp.expires_at > NOW()
)
```

Accept path (`acceptRide`): before assigning, re-check `availableCredits(driverId) >= 1`; if zero, throw a `ForbiddenError('No ride credits left — buy a pack to continue')`. In-progress/assigned rides are unaffected 

**Validates: Requirements **. Buying a pack immediately makes the `EXISTS` true again, so broadcasts resume on the next sweep/emit 

**Validates: Requirements **.

## Razorpay integration (`razorpay.ts`)

Uses the official `razorpay` Node SDK with `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` (new env vars; documented in `.env.example`).

```ts
createPackOrder(amountRupees, receipt): Promise<{ orderId, amount, currency, keyId }>
verifyPaymentSignature({ orderId, paymentId, signature }): boolean  // HMAC-SHA256
validateVpa(vpa): Promise<{ valid: boolean; customerName?: string }> // Razorpay VPA validate API
```

### Pack purchase flow 

**Validates: Requirements **

```
Driver app                 Backend (packOrder.service)         Razorpay
  |-- POST /driver/packs/order {packKey} ->|
  |                                        |-- orders.create(amount) -->|
  |<-- { orderId, amount, keyId } ---------|<-- order --------------------|
  |-- Razorpay Checkout (in-app) ------------------------------------->|
  |<-- { paymentId, signature } --------------------------------------|
  |-- POST /driver/packs/verify {orderId,paymentId,signature} ->|
  |                                        verifySignature() → activatePurchasedPack() [idempotent]
  |<-- { pack, credits } ------------------|
        (webhook payment.captured also calls activate → no-op if already done)
```

Webhook endpoint `POST /webhooks/razorpay` verifies the webhook signature and calls the same idempotent `activate`. This covers the case where the app closes before `/verify`.

### Direct supervisor → driver payment 

**Validates: Requirements **

- **Save UPI (driver):** `POST /driver/upi { vpa }` → `validateVpa` → on success store `upiVpa`, `upiVpaName`, `upiVerified=true`. On failure return descriptive error, store nothing 

**Validates: Requirements **.
- **Pay QR (supervisor):** `GET /rides/:id/pay-qr` → if ride completed and driver `upiVerified`, build a `upi://pay?pa=<vpa>&pn=<name>&am=<price+escort>&cu=INR&tn=RideOps%20<rideId>` string; frontend renders it as a QR (existing `qrcode`-style rendering or a small lib). If no verified VPA → 409 with message 

**Validates: Requirements **. This payment is never recorded as a platform transaction 

**Validates: Requirements **.

## API changes

### New
- `GET  /driver/packs/catalog` → the 3 packs.
- `GET  /driver/credits` → `{ available, packs: [{ id, creditsRemaining, expiresAt, source }] }`.
- `POST /driver/packs/order` `{ packKey }` → Razorpay order.
- `POST /driver/packs/verify` `{ orderId, paymentId, signature }` → activate.
- `POST /webhooks/razorpay` → webhook (signature-verified) → activate.
- `POST /driver/upi` `{ vpa }` → validate + save.
- `GET  /rides/:id/pay-qr` → `{ upiIntent, payeeName, amount }` (supervisor).
- `GET  /admin/pack-sales?from&to` → sales rows + aggregates 

**Validates: Requirements **.

### Removed
- `POST /driver/withdraw`, `GET /driver/payouts`, payout webhook.
- `GET/POST /driver/bank-detail` (replaced by `/driver/upi`).
- Wallet fields from `GET /driver/me` and wallet from `GET /driver/wallet` (endpoint removed).

## Frontend changes

- **DriverAccountPanel**: rename "Wallet & Ride Earnings" section → two sections: **Ride Credits** (`DriverCredits.tsx`) and **Payout UPI** (`DriverUpiCard.tsx`).
- **DriverCredits.tsx**: shows total available credits, a list of active packs with remaining count + expiry, the 3-pack catalog with a Buy button that opens Razorpay Checkout, and post-payment confirmation. Shows a clear "0 credits — buy a pack to receive rides" empty state.
- **DriverUpiCard.tsx**: input + "Validate & Save"; shows verified name on success.
- **Supervisor payment step**: after a ride completes, show the driver's UPI QR (from `/rides/:id/pay-qr`) with payee name and amount; a "mark as paid" is local-only bookkeeping (untracked).
- **Remove**: `WalletCard`, `WithdrawSection`, `PayoutHistory`, and their `queries.ts` hooks.
- Driver-cancel dialog and scheduled-release UI: remove all fine-warning copy (no fine now).

## Error Handling

| Scenario | Handling |
|---|---|
| Razorpay signature invalid 

**Validates: Requirements ** | `/verify` returns 400; no `CreditPack` created; `PackOrder.status='failed'`. |
| Duplicate activation (confirm + webhook) 

**Validates: Requirements ** | Guarded transaction on `PackOrder.activatedPackId`; second caller no-ops. |
| Complete ride with 0 credits 

**Validates: Requirements ** | Ride completes; `consumeOneCredit` finds no pack, burns nothing, `credit_consumed=false`. |
| VPA validation fails 

**Validates: Requirements ** | 422 with message; nothing stored; `upiVerified` stays false. |
| Supervisor opens pay-QR, driver has no VPA 

**Validates: Requirements ** | 409 with "Driver hasn't added a payable UPI ID." |
| Archive migration error 

**Validates: Requirements ** | Destructive step aborts; old data left intact; deploy blocked. |
| Pack expired mid-consume | `expires_at > NOW()` in the consume query excludes it; falls through to next pack or none. |

## Correctness Properties

These invariants must hold for every code path and are the basis for the tests below.

### Property 1: Exactly-once credit burn
A ride in `completed` state has consumed exactly one credit iff `creditConsumed = true`; a ride never in `completed` has consumed zero. Re-running completion never burns a second credit. 

**Validates: Requirements **

### Property 2: No burn on non-completion
A ride that ends `cancelled`, `expired`, or with all pax `no_show` consumes zero credits. 

**Validates: Requirements **

### Property 3: Oldest-first, single-burn
Each consumption decrements exactly one credit from the active, unexpired pack with the earliest `(expiresAt, createdAt)`; ties resolve to exactly one pack. 

**Validates: Requirements **

### Property 4: Available-credit definition
`availableCredits(d) = Σ creditsRemaining` over packs where `status='active' AND creditsRemaining > 0 AND expiresAt > NOW()`. Expired/exhausted packs contribute zero. 

**Validates: Requirements **

### Property 5: Eligibility equivalence
A driver appears in broadcast candidate queries iff `availableCredits(d) ≥ 1` (in addition to the pre-existing online/KYC/active-ride filters). 

**Validates: Requirements **

### Property 6: Assigned rides are credit-independent
A ride already in `assigned` or `in_progress` can always reach `completed` regardless of the driver's current credit count. 

**Validates: Requirements **

### Property 7: Idempotent activation
For a given `razorpayOrderId`, at most one `CreditPack` is ever created; concurrent confirm+webhook calls yield one pack. 

**Validates: Requirements **

### Property 8: Grant-once bonus
Each driver has at most one `joining_bonus` `CreditPack`, guarded by `joiningBonusGrantedAt`. 

**Validates: Requirements **

### Property 9: Supervisor total identity
For every ride, the amount shown to the supervisor equals `price + escortCharge` with no additional platform-fee or cancellation-fee term. 

**Validates: Requirements **

### Property 10: No-silent-loss
After migration, `count(driver_fines_archive)` equals the pre-migration `count(driver_fines)`, and likewise for payouts, bank details, wallet balances, and pending cancellation fees. 

**Validates: Requirements **

### Property 11: VPA verification integrity
`upiVerified = true` implies `upiVpa` and `upiVpaName` are both set from a successful validation; a failed validation leaves all three unchanged. 

**Validates: Requirements **

## Testing Strategy

- **Unit**: `consumeOneCredit` oldest-first ordering; tiebreak on equal expiry burns exactly one 

**Validates: Requirements **; no-show/cancel burns nothing; expiry excludes packs; `availableCredits` sums correctly.
- **Unit**: `activatePurchasedPack` idempotency — calling twice for one order creates one `CreditPack`.
- **Unit**: signature verification (valid/invalid); VPA validation success/failure branches (Razorpay mocked).
- **Integration**: pack purchase → order → verify → credits added → eligible for broadcast; run out → excluded from `findNearbyDrivers` → buy → included again.
- **Integration**: complete ride burns one credit; accept blocked at 0 credits; assigned ride still completes at 0 credits.
- **Migration**: run against a seeded DB with wallet balances, fines, payouts, pending fees → assert archives populated, columns/tables removed, one joining-bonus pack per active driver, row counts preserved.
- **Pricing**: `computeFare` unchanged; supervisor total = `price + escort` with no platform-fee/cancellation-fee terms.

## Rollout / Migration Plan

1. Deploy backend with additive migration + new tables + new endpoints (old wallet/fine code paths still present but dormant behind feature flag `SUBSCRIPTION_MODEL=on`).
2. Run data-migration script (archives + backfill joining-bonus packs for existing active drivers).
3. Flip `SUBSCRIPTION_MODEL=on`: pricing drops platform fee, eligibility gates on credits, completion burns credits, fines become no-ops.
4. After a stable period, run the destructive migration (rename to `_archive`, drop columns).
5. Ship frontend that hides wallet/withdraw/payout and shows credits + UPI.

Splitting deploy from the destructive drop means a rollback in step 3 doesn't lose data.

## Open Questions / Assumptions

- **Assumption:** existing active drivers each get **one** backfilled joining-bonus credit on migration so they aren't locked out the moment the credit gate turns on. (Confirm — alternative is a short grace window where 0-credit drivers still receive broadcasts.)
- **Assumption:** the supervisor "mark as paid" after scanning the QR is local bookkeeping only (untracked), consistent with Req 14.4. If you later want tracking, that's Razorpay Route (out of scope).
- **Assumption:** Razorpay Checkout works inside the Capacitor webview via the standard web checkout; if not, we use Razorpay Payment Links (hosted page) opened in the system browser.

