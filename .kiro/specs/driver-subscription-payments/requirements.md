# Requirements Document

## Introduction

This feature is a major overhaul of the driver and supervisor payment model in the WeKashi RideOps B2B corporate cab platform. It replaces the current wallet-and-fine economy with a subscription-based ride-credit model that becomes the platform's revenue source, and restructures how supervisors pay drivers.

The overhaul spans four coordinated changes:

1. **Removal of the driver fine system** — all fine calculation, wallet debits, and `driver_fines` audit rows are removed. Driver actions that previously incurred fines still function, but with no penalty. The supervisor-side cancellation fee is also removed.
2. **Removal of the driver wallet** — wallet balance, bank/UPI withdrawal flow, and payout history are removed. Drivers are no longer paid through an in-app wallet.
3. **Driver ride-credit subscription packs** — drivers purchase ride-credit packs (the new revenue source). Credits are consumed on ride completion and gate a driver's eligibility to receive broadcasts.
4. **Payments restructure** — the platform fee charged to supervisors is removed. Pack purchases are collected through the platform's Razorpay account (trackable). Supervisors pay drivers directly via a validated UPI QR code (untracked, an accepted tradeoff).

Escort logic and women's-safety / escort-OTP flows are out of scope and remain unchanged. The ₹500 minimum ride fare is already implemented and is not part of this feature.

## Glossary

- **RideOps_Platform**: The overall system operated by WeKashi that connects supervisors, drivers, and vendors.
- **Driver**: A person who accepts and completes rides. Belongs to a Vendor.
- **Supervisor**: A person who books rides for employees and pays the assigned Driver.
- **Vendor**: An organization that owns Drivers and vehicles.
- **Admin**: A platform operator with oversight of pack sales and system data.
- **Ride_Credit**: A single unit that entitles a Driver to complete one ride. Consumed only on ride completion.
- **Credit_Pack** (or **Pack**): A purchased bundle of Ride_Credits with its own remaining-credit count and its own expiry date. Purchased packs stack; each is an independent bucket.
- **Joining_Bonus_Credit**: A single free Ride_Credit granted to every newly onboarded Driver.
- **Pack_Catalog**: The fixed set of purchasable pack definitions (5 rides / ₹100, 10 rides / ₹159, 20 rides / ₹249), all valid 365 days.
- **Credit_Ledger**: The mechanism that tracks a Driver's Credit_Packs, their remaining credits, and expiries, and from which credits are consumed.
- **Pack_Payment_Service**: The backend component that creates Razorpay orders for pack purchases and activates packs on successful payment.
- **Razorpay_Platform_Account**: The platform's Razorpay account into which pack-purchase money is collected and where orders are trackable by order ID.
- **UPI_VPA**: A Driver's UPI Virtual Payment Address (e.g. `name@bank`), used for direct supervisor-to-driver payment.
- **VPA_Validation_Service**: The backend component that validates a UPI_VPA using Razorpay's VPA-validation API and returns the account holder name.
- **UPI_QR**: A `upi://` intent string, rendered as a QR code, that a Supervisor scans to pay a Driver directly.
- **Ride_Lifecycle**: The set of ride statuses: broadcasting, assigned, in_progress, completed, expired, cancelled, scheduled.
- **Broadcast**: The act of offering a ride to nearby eligible Drivers.
- **Data_Migration**: The one-time handling of existing production wallet balances and related records when the wallet is removed.

## Requirements

### Requirement 1: Remove driver fine calculation and audit records

**User Story:** As a Driver, I want the fine system removed, so that legitimate ride actions no longer cost me money.

#### Acceptance Criteria

1. WHEN a Driver drops an assigned ride after confirming arrival, THE RideOps_Platform SHALL return the ride to broadcasting status without debiting any amount from the Driver and without creating a fine record.
2. WHEN a Driver releases a claimed scheduled ride, THE RideOps_Platform SHALL return the ride to the marketplace without debiting any amount from the Driver and without creating a fine record.
3. WHEN a scheduled ride that a Driver claimed is swept as a no-show, THE RideOps_Platform SHALL expire the ride regardless of other system state, without debiting any amount from the Driver and without creating a fine record.
4. THE RideOps_Platform SHALL remove the fine calculation functions (releaseFine, DRIVER_DROP_AFTER_ARRIVAL_FINE, SCHEDULED_NO_SHOW_FINE, and their supporting release-notice constants) from the pricing logic.
5. THE RideOps_Platform SHALL remove creation of `driver_fines` records from all ride operations.
6. WHERE historical `driver_fines` data exists in the database, THE RideOps_Platform SHALL preserve or archive that data through a defined Data_Migration rather than deleting it silently.

### Requirement 2: Remove the supervisor cancellation fee

**User Story:** As a Supervisor, I want no cancellation fee applied to my bookings, so that my ride total reflects only fare and escort charges.

#### Acceptance Criteria

1. WHEN a Supervisor cancels a ride, THE RideOps_Platform SHALL complete the cancellation without accruing a pending cancellation fee against the Supervisor.
2. WHEN a Supervisor creates a ride, THE RideOps_Platform SHALL compute the Supervisor total as the ride price plus the escort charge, with no cancellation fee component and no platform fee component.
3. THE RideOps_Platform SHALL remove the `pendingCancellationFee` field usage from ride creation and ride cancellation logic.
4. WHERE a Supervisor has a non-zero pending cancellation fee stored at the time this feature is deployed, THE RideOps_Platform SHALL clear that balance to zero through a defined Data_Migration.
5. WHILE the pending-cancellation-fee clearing Data_Migration has not completed, THE RideOps_Platform SHALL block deployment of this feature.

### Requirement 3: Remove the driver wallet balance and earnings display

**User Story:** As a Driver, I want the wallet removed, so that I understand I am paid directly by the Supervisor rather than through an in-app balance.

#### Acceptance Criteria

1. THE RideOps_Platform SHALL remove the driver wallet balance from all Driver-facing screens.
2. THE RideOps_Platform SHALL remove the wallet balance field and both its read and its write operations from the Driver backend.
3. WHEN a ride payment is completed, THE RideOps_Platform SHALL NOT credit any in-app balance to the Driver.
4. WHERE existing Drivers hold non-zero wallet balances in the production database, THE RideOps_Platform SHALL handle those balances through a defined Data_Migration that preserves a record of each balance before removal.

### Requirement 4: Remove the driver withdrawal and payout flow

**User Story:** As a Driver, I want the withdrawal and payout features removed, so that the app matches the new direct-payment model.

#### Acceptance Criteria

1. THE RideOps_Platform SHALL remove the Driver withdraw-to-UPI and withdraw-to-bank flow from the Driver app.
2. THE RideOps_Platform SHALL remove the payout history screen from the Driver app.
3. THE RideOps_Platform SHALL remove the withdrawal, payout-history, and payout-webhook backend endpoints.
4. WHERE historical payout transaction records exist in the database, THE RideOps_Platform SHALL preserve or archive that data through a defined Data_Migration rather than deleting it silently.
5. WHERE no historical payout transaction records exist in the database, THE RideOps_Platform SHALL skip the payout Data_Migration.
6. IF the payout Data_Migration encounters an error during execution, THEN THE RideOps_Platform SHALL leave the historical payout data in place until the error is resolved.

### Requirement 5: Define the ride-credit pack catalog

**User Story:** As a Driver, I want a fixed set of clearly priced ride-credit packs, so that I can choose how many rides to buy.

#### Acceptance Criteria

1. THE RideOps_Platform SHALL offer exactly three purchasable packs: a pack of 5 credits priced at ₹100, a pack of 10 credits priced at ₹159, and a pack of 20 credits priced at ₹249.
2. THE RideOps_Platform SHALL assign every pack a validity of 365 days from the time the pack becomes active.
3. WHEN a Driver views the pack catalog, THE RideOps_Platform SHALL display each pack's credit count, price, and validity period.

### Requirement 6: Purchase a ride-credit pack via Razorpay

**User Story:** As a Driver, I want to buy a ride-credit pack through Razorpay, so that I can receive ride broadcasts.

#### Acceptance Criteria

1. WHEN a Driver initiates a pack purchase, THE Pack_Payment_Service SHALL create a Razorpay order in the Razorpay_Platform_Account for the selected pack's price and return the order details to the Driver app.
2. WHEN a Driver completes payment and the payment is verified as captured, THE Pack_Payment_Service SHALL add the purchased pack's credits to the Driver's Credit_Ledger and set the pack to active.
3. WHEN a pack becomes active, THE RideOps_Platform SHALL set the pack's expiry date to 365 days after activation and set the pack's remaining credit count to the pack's full credit count.
4. IF the Razorpay payment signature verification fails, THEN THE Pack_Payment_Service SHALL reject the purchase and add no credits to the Driver.
5. THE Pack_Payment_Service SHALL record the Razorpay order identifier against each pack purchase so that the purchase is traceable in the Razorpay console.
6. WHEN a pack purchase payment is captured, THE Pack_Payment_Service SHALL activate the pack exactly once for that order even if the confirmation and the webhook both report the same captured payment.

### Requirement 7: Grant a joining-bonus credit on driver onboarding

**User Story:** As a newly onboarded Driver, I want one free ride credit, so that I can start receiving broadcasts before buying a pack.

#### Acceptance Criteria

1. WHEN a Driver is onboarded, THE RideOps_Platform SHALL grant the Driver exactly one Joining_Bonus_Credit.
2. THE RideOps_Platform SHALL treat the Joining_Bonus_Credit as an available Ride_Credit for the purpose of Broadcast eligibility.
3. THE RideOps_Platform SHALL grant the Joining_Bonus_Credit only once per Driver.

### Requirement 8: Stack packs and track per-pack credits and expiry

**User Story:** As a Driver, I want each pack I buy tracked separately, so that I can see how many credits remain and when each pack expires.

#### Acceptance Criteria

1. WHEN a Driver purchases a pack while holding one or more existing packs, THE Credit_Ledger SHALL store the new pack as an independent bucket with its own remaining credit count and its own expiry date.
2. THE Credit_Ledger SHALL maintain, for each of a Driver's packs, a remaining credit count and an expiry date.
3. WHEN a Driver views credit information, THE RideOps_Platform SHALL display the Driver's total available credits and the remaining credits and expiry date of each active pack.

### Requirement 9: Expire packs on validity end or credit exhaustion

**User Story:** As a Driver, I want packs to expire predictably, so that I know when credits are no longer usable.

#### Acceptance Criteria

1. WHEN 365 days have elapsed since a pack became active, THE RideOps_Platform SHALL mark that pack as expired and make its remaining credits unavailable.
2. WHEN a pack's remaining credit count reaches zero, THE RideOps_Platform SHALL mark that pack as expired.
3. THE Credit_Ledger SHALL exclude credits from expired packs when computing a Driver's total available credits.

### Requirement 10: Consume credits on ride completion using oldest-expiring-first

**User Story:** As a Driver, I want credits consumed only when I finish a ride and in expiry order, so that credits closest to expiring are used before they lapse.

#### Acceptance Criteria

1. WHEN a Driver completes a ride, THE Credit_Ledger SHALL consume exactly one Ride_Credit from the Driver's active packs.
2. WHEN consuming a Ride_Credit, THE Credit_Ledger SHALL take the credit from the active pack with the earliest expiry date.
3. WHEN a ride ends in a no-show state, THE Credit_Ledger SHALL consume no Ride_Credit for that ride.
4. WHEN a ride ends in a cancelled state, THE Credit_Ledger SHALL consume no Ride_Credit for that ride.
5. WHILE a Driver holds two packs with the same earliest expiry date, THE Credit_Ledger SHALL consume the credit from exactly one of those packs so that the total consumed for one completed ride is exactly one credit.

### Requirement 11: Gate broadcast eligibility on available credits

**User Story:** As a Supervisor, I want only Drivers with credits to receive my ride broadcasts, so that ride offers go to Drivers who can complete them.

#### Acceptance Criteria

1. WHILE a Driver has at least one available Ride_Credit, THE RideOps_Platform SHALL treat the Driver as eligible to receive and accept Broadcasts, subject to the platform's existing online and location criteria.
2. WHILE a Driver has zero available Ride_Credits, THE RideOps_Platform SHALL exclude the Driver from new Broadcasts and prevent the Driver from accepting new Broadcasts.
3. WHEN a Driver's available credit count reaches zero during the day, THE RideOps_Platform SHALL stop sending new Broadcasts to that Driver.
4. WHILE a Driver has zero available Ride_Credits, THE RideOps_Platform SHALL allow any ride the Driver has already accepted or has in progress to be completed normally.
5. WHEN a Driver purchases a new pack after reaching zero credits, THE RideOps_Platform SHALL resume sending Broadcasts to that Driver.

### Requirement 12: Remove the platform fee from supervisor totals

**User Story:** As a Supervisor, I want no platform fee added to my ride total, so that I pay only fare and escort.

#### Acceptance Criteria

1. THE RideOps_Platform SHALL remove the platform-fee constant and its addition from all ride pricing and payment computations.
2. WHEN a Supervisor views the amount owed for a completed ride, THE RideOps_Platform SHALL display the ride price plus escort charge with no platform-fee line.

### Requirement 13: Save and validate a driver UPI VPA

**User Story:** As a Driver, I want to save a validated UPI ID, so that Supervisors can pay me directly.

#### Acceptance Criteria

1. WHEN a Driver submits a UPI_VPA, THE VPA_Validation_Service SHALL validate the UPI_VPA using Razorpay's VPA-validation API.
2. WHEN a UPI_VPA is validated successfully, THE RideOps_Platform SHALL store the UPI_VPA and the returned account holder name for the Driver, and mark the UPI_VPA as verified.
3. IF a UPI_VPA fails validation, THEN THE RideOps_Platform SHALL reject the submission, retain no verified UPI_VPA from that submission, and return a descriptive error to the Driver.
4. WHEN a Driver views the saved UPI_VPA, THE RideOps_Platform SHALL display the stored UPI_VPA and its verified account holder name.

### Requirement 14: Generate and display a UPI QR for direct supervisor payment

**User Story:** As a Supervisor, I want to scan a QR code to pay the Driver after a ride, so that I can settle the fare directly.

#### Acceptance Criteria

1. WHEN a ride is completed and the assigned Driver has a verified UPI_VPA, THE RideOps_Platform SHALL generate a UPI_QR as a `upi://` intent string addressed to the Driver's UPI_VPA for the amount owed.
2. WHEN a Supervisor views the payment step for a completed ride, THE RideOps_Platform SHALL display the Driver's UPI_QR and the account holder name so the Supervisor can pay the Driver directly.
3. IF the assigned Driver has no verified UPI_VPA, THEN THE RideOps_Platform SHALL inform the Supervisor that the Driver has not provided a payable UPI_VPA.
4. THE RideOps_Platform SHALL treat the direct supervisor-to-driver UPI payment as occurring outside the Razorpay_Platform_Account and SHALL NOT record it as a platform-tracked transaction.

### Requirement 15: Provide admin visibility into pack sales

**User Story:** As an Admin, I want visibility into pack sales, so that I can monitor the platform's revenue.

#### Acceptance Criteria

1. WHEN an Admin views pack sales, THE RideOps_Platform SHALL display each pack purchase including the purchasing Driver, the pack purchased, the amount paid, the Razorpay order identifier, and the purchase timestamp.
2. WHEN an Admin views pack sales, THE RideOps_Platform SHALL display aggregate totals of pack revenue and pack count over a selectable time period.
