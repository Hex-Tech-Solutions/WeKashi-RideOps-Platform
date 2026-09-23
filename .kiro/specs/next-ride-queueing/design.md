# Design Document

## Overview

Next-ride queueing lets a driver within a finishing distance of their current ride's drop accept a new live broadcast, which is then held as a **queued ride** and auto-activated when the current ride completes. The supervisor console reflects queued state in real time.

The design reuses the existing dispatch, accept, completion, and socket machinery and makes four targeted changes:

1. **Eligibility** — relax the "on active ride" exclusion in `findNearbyDrivers` so a driver whose ride is `in_progress` AND within `FINISHING_DISTANCE_KM` of its final drop, holds no queued ride, and has credits, is eligible.
2. **Accept** — `acceptRide` detects that the driver is mid-ride-but-finishing and marks the newly-accepted ride as queued (`queuedBehindRideId`) instead of requiring the driver to be idle; it does NOT assign it as the live active ride.
3. **Completion** — when a ride transitions to `completed`, promote the driver's queued ride (if any) to a normal active ride and run the assignment side effects once.
4. **Realtime** — emit socket events so the supervisor sees `queued` → `active` transitions live.

Ride-credit gating and one-credit-per-completed-ride consumption are unchanged. Escort/OTP/minimum-fare are untouched.

## Architecture

```
BEFORE: a driver on an assigned/in_progress ride is excluded from ALL broadcasts.

AFTER:
  Active ride in_progress, driver within 3km of drop, no queued ride, has credits
     └─> driver re-enters the broadcast candidate pool
          └─> accepts a broadcast  →  ride marked QUEUED (queued_behind_ride_id = active.id)
                                       (OTP SMS deferred; active ride untouched)
     Active ride completes / cancelled / expired
          └─> promoteQueuedRide(): clear queued marker → queued ride becomes the active ride
               └─> send pax OTP SMS once, emit supervisor socket update
```

Eligibility, accept, and completion are the three existing pipelines we touch; each change is additive and guarded so the idle-driver path is byte-for-byte unchanged. Realtime updates ride the existing `/supervisor` and `/admin` socket namespaces.

## Data Models

### Edited: `Ride`

Add a single nullable self-reference marking a ride as queued behind another:

```prisma
model Ride {
  // ...existing fields...
  /// Set when a driver accepted this ride while still finishing another ride.
  /// While non-null, this ride is the driver's QUEUED ride: assigned to them
  /// but not yet their active ride. Cleared when the ride is activated.
  queuedBehindRideId String? @map("queued_behind_ride_id")
}
```

A ride is a **Queued_Ride** iff `driverId IS NOT NULL AND status = 'assigned' AND queuedBehindRideId IS NOT NULL`.
A ride is a normal **Active_Ride** iff `status IN ('assigned','in_progress') AND queuedBehindRideId IS NULL`.

No new enum value is added — a queued ride reuses `assigned`, distinguished by `queuedBehindRideId`. This keeps every existing status query correct except where we explicitly account for queued rides (below).

`@@index([driverId, queuedBehindRideId])` supports the "does this driver already hold a queued ride?" check.

## Configuration

```ts
// backend/src/lib/dispatch.ts (new) or ride.service.ts constant
export const FINISHING_DISTANCE_KM = 3; // Finishing_Window radius (Req: 2–3 km)
```

## Components and Interfaces

This section defines the eligibility, accept, and completion changes and the HTTP/socket surface. Data is defined in **Data Models** above.

## Eligibility — `findNearbyDrivers` (Req 1)

Today the query excludes any driver whose id is in a ride with status `assigned`/`in_progress`. We replace that hard exclusion with a rule that also admits **finishing** drivers:

```sql
-- Replace the current:
--   AND id NOT IN (SELECT driver_id FROM rides WHERE status IN ('assigned','in_progress'))
-- with:
AND NOT EXISTS (
  -- Block drivers who are on an active ride UNLESS they are finishing it.
  SELECT 1 FROM rides act
  WHERE act.driver_id = drivers.id
    AND act.queued_behind_ride_id IS NULL          -- the active ride, not a queued one
    AND (
      act.status = 'assigned'                       -- not started yet → never eligible
      OR (
        act.status = 'in_progress'
        AND ST_DWithin(
          drivers.current_location,
          act.drop_point,
          ${FINISHING_DISTANCE_KM * 1000}
        ) IS NOT TRUE                                -- NOT within finishing distance → still busy
      )
    )
)
-- And block drivers who already hold a queued ride:
AND NOT EXISTS (
  SELECT 1 FROM rides q
  WHERE q.driver_id = drivers.id
    AND q.status = 'assigned'
    AND q.queued_behind_ride_id IS NOT NULL
)
```

The distance is measured from the driver's **current buffered location** (`drivers.current_location`, already kept ≤60s fresh by `locationBuffer.ts`) to the active ride's `drop_point`. The existing credit `EXISTS` gate and online/active/KYC/vehicle-type filters are unchanged, so Req 1.4 (needs credits) holds automatically.

The same relaxed predicate is applied to `nearbyDriversForRide` (supervisor manual-assign picker) for consistency, but `vehicleAvailability` (booking-time counts) keeps the strict rule — a finishing driver shouldn't inflate "available now" counts.

## Accept — `acceptRide` (Req 2)

`acceptRide` runs in a `FOR UPDATE SKIP LOCKED` transaction on the broadcasting ride. We add queued-detection:

```
within acceptRide(rideId, driverId):
  lock broadcasting ride (existing)
  creditGate: availableCredits(driverId) >= 1 (existing, Req 2.4)

  # NEW — find the driver's current active (non-queued) ride
  active = SELECT id, status FROM rides
           WHERE driver_id = driverId
             AND queued_behind_ride_id IS NULL
             AND status IN ('assigned','in_progress')
           LIMIT 1 FOR UPDATE

  if active exists:
     # driver is mid-ride → this becomes a QUEUED ride
     if driver already has a queued ride: throw ConflictError (Req 2.3)
     if active.status != 'in_progress' or driver NOT within FINISHING_DISTANCE of active.drop:
        throw ConflictError('Finish your current ride to accept more')   # defense-in-depth vs stale broadcast
     UPDATE rides SET status='assigned', driver_id=driverId,
                      vendor_id=<driver vendor>, accepted_at=NOW(),
                      queued_behind_ride_id = active.id                    # Req 2.5
       WHERE id = rideId
     # DO NOT send pax OTP SMS yet — deferred to activation (Req 3.3)
  else:
     # existing normal accept path (assigns as active, sends OTP SMS)
```

Expire other pending offers and clear the Redis broadcast key exactly as today. The key invariant: a queued accept sets `queuedBehindRideId` and defers OTP SMS; a normal accept is unchanged.

## Completion / activation — `advanceRideStatus` + `maybeComplete` (Req 3)

Credit consumption on completion already happens in a transaction (`consumeOneCredit`). We add **queued-ride promotion** in the same place a ride reaches `completed`. Because completion happens in two code paths — the explicit `advanceRideStatus(... 'completed')` and the implicit `maybeComplete()` (logout auto-complete after last drop) — promotion is factored into one helper called from both:

```ts
// called inside the SAME transaction that set status='completed'
async function promoteQueuedRide(tx, completedRideId, driverId) {
  const q = await tx.$queryRaw`
    SELECT id FROM rides
    WHERE driver_id = ${driverId}
      AND queued_behind_ride_id = ${completedRideId}
      AND status = 'assigned'
    FOR UPDATE`;
  if (!q.length) return null;              // Req 3.4 — nothing queued
  await tx.$executeRaw`
    UPDATE rides SET queued_behind_ride_id = NULL WHERE id = ${q[0].id}`; // Req 3.2
  return q[0].id;
}
```

After the transaction commits, the activation side effects run **once** (Req 3.3): `sendPaxOtpSms(promotedRideId)` and the socket emits below. Credit consumption for the completed ride is unchanged and independent of promotion (Req 3.5 / 6.3).

Edge case (Req 4.3): if the active ride is **cancelled or expired** (not completed) while a queued ride exists, the same promotion runs from `cancelRide` and the sweeper's expire path, so the driver is freed to serve the queued ride rather than being stuck holding it. (Credit is NOT consumed for a cancelled/expired ride — unchanged.)

## Manual assignment — `manualAssignRide` (Req 7)

`manualAssignRide` bypasses `acceptRide` and sets `status='assigned'` directly, so it must enforce the same invariant or it becomes a loophole that double-books a busy driver. Add the same active-ride detection used in `acceptRide`:

- No active ride → assign normally (unchanged).
- Active ride `in_progress` + within finishing distance + no queued ride + credits → set `queuedBehindRideId = active.id` (queued), defer OTP.
- Active ride present but not finishing, OR driver already holds a queued ride → reject with a clear message.

## Release / cancel / drop resolution (Req 4, Req 8)

- **Driver releases queued ride**: detect inside `driverCancelAssignedRide` (or a thin `POST /rides/:id/release-queued`) — the ride is queued (`queuedBehindRideId IS NOT NULL`), so return it to `broadcasting`, clear `queuedBehindRideId`, re-broadcast. No penalty.
- **Driver drops the ACTIVE ride while a queued ride exists** (Req 8.2): `driverCancelAssignedRide` on the active ride must, in the same transaction, promote the queued ride (clear its marker so it becomes the new active ride) — the queued ride is NOT sent back to broadcasting; the driver keeps it. This prevents an orphaned marker (Req 8.3).
- **Supervisor cancels the active ride while a queued ride exists** (Req 8.1): `cancelRide` promotes the queued ride in the same transaction.
- **Supervisor cancels the queued ride itself** (Req 4.2): `cancelRide` sets `cancelled` and clears `queuedBehindRideId`.
- **Active ride expires via sweeper while a queued ride exists** (Req 8.1): the expire path promotes the queued ride.

Promotion is centralized in `promoteQueuedRide(tx, terminatedRideId, driverId)` and called from every place an active ride terminates: completion (`advanceRideStatus`, `maybeComplete`), cancel (`cancelRide`), driver-drop (`driverCancelAssignedRide`), and expiry (sweeper). This guarantees Req 8.3 — no code path can terminate an active ride and leave its queued ride orphaned.

## Realtime supervisor visibility (Req 5)

Reuse the existing supervisor socket namespace (`/supervisor`, room `supervisor:<id>`) and admin activity feed. New/changed emits:

- On queued accept: emit `ride:status_changed { rideId, status: 'assigned', queued: true, aheadRideId }` to the queued ride's supervisor (Req 5.1/5.2).
- On promotion (activation): emit `ride:status_changed { rideId, status: 'assigned', queued: false }` (Req 5.3).
- On queued release/cancel: emit `ride:status_changed` / `ride:expired` as appropriate (Req 5.4).

The ride payload returned by `getRide`/`listRides` includes `queuedBehindRideId`, so the supervisor UI can render a "Driver finishing another ride first" badge and, when it clears, switch to the normal assigned view. Frontend: `RideRow`/ride detail gains `queuedBehindRideId`; Live/console shows the badge and updates on the socket event.

## API changes

- `POST /rides/:id/accept` (existing) — now may produce a queued assignment; response indicates `{ queued: boolean }`.
- `POST /rides/:id/release-queued` (new, driver) — release a queued ride back to the marketplace.
- `GET /rides/:id`, `GET /driver/rides`, supervisor lists — include `queuedBehindRideId` (and a derived `queued` boolean).

## Error Handling

| Scenario | Handling |
|---|---|
| Driver accepts but already holds a queued ride (Req 2.3) | `ConflictError('You already have a queued ride')`. |
| Driver accepts while active ride not `in_progress` / not within finishing distance (stale broadcast) | `ConflictError('Finish your current ride to accept more')`. |
| Two finishing drivers accept the same broadcast | Existing `FOR UPDATE SKIP LOCKED` on the broadcasting ride → exactly one wins (Req 6.2). |
| Active ride completes with no queued ride (Req 3.4) | Normal completion, no promotion. |
| Active ride cancelled/expired with a queued ride (Req 4.3) | Promote queued ride to active. |
| Duplicate completion transitions | Promotion is guarded by `queued_behind_ride_id = completedRideId` + `FOR UPDATE`; a second call finds nothing to promote. |

## Correctness Properties

### Property 1: At most one active ride
For any driver, at most one ride has `status IN ('assigned','in_progress') AND queued_behind_ride_id IS NULL`. **Validates: Requirements 6.1**

### Property 2: At most one queued ride
For any driver, at most one ride has `status='assigned' AND queued_behind_ride_id IS NOT NULL`. **Validates: Requirements 1.3, 2.3**

### Property 3: Exactly-once broadcast win
A broadcasting ride is assigned to exactly one driver, whether accepted normally or as a queued ride. **Validates: Requirements 6.2**

### Property 4: Promotion once
A queued ride is promoted at most once, exactly when its `queued_behind_ride_id` ride terminates (completes, cancels, or expires). **Validates: Requirements 3.1, 3.2**

### Property 5: Credit per completion
One credit is consumed per completed ride; a queued ride does not consume a credit until it is itself completed. **Validates: Requirements 3.5, 6.3**

### Property 6: Finishing gate
A mid-ride driver is broadcast-eligible iff their active ride is `in_progress`, their location is within `FINISHING_DISTANCE_KM` of its drop, they hold no queued ride, and they have at least one available credit. **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5**

## Testing Strategy

- **Unit/integration (DB-backed)**: finishing driver appears in `findNearbyDrivers`, non-finishing does not; driver with a queued ride excluded; queued accept sets `queuedBehindRideId` and defers OTP; second queued accept rejected; completion promotes queued ride and clears marker and sends OTP once; completion still burns exactly one credit; cancel/expire of active ride promotes queued ride; supervisor cancel of queued ride clears marker.
- **Concurrency**: two finishing drivers race for one broadcast → one wins.
- **Regression**: normal (idle-driver) accept and completion unchanged; escort auto-complete path still promotes.

## Rollout / Migration Plan

1. Additive migration: add `rides.queued_behind_ride_id` (nullable) + index. Backwards-safe; existing rows are all `NULL` (no queued rides).
2. Deploy backend (eligibility + accept + promotion + routes + sockets).
3. Ship frontend (driver "next ride" surfacing during finish; supervisor queued badge).
4. No destructive changes; fully reversible by ignoring the column.

## Assumptions / Open Questions

- **Finishing distance = 3 km** straight-line from the buffered driver location to the ride `drop_point`. Confirm the value; it's a single constant.
- **One ride ahead only** — a driver can hold exactly one queued ride. (Matches the request.)
- Location freshness is the existing ≤60s buffer; a driver right at the drop may briefly appear eligible/ineligible as the buffer updates — acceptable, and the accept path re-checks.
- Queued rides are **immediate broadcasts**, not scheduled marketplace rides (scheduled rides already have their own claim flow).
