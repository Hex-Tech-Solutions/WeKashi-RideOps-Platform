# Implementation Plan

## Overview

Implements next-ride queueing: a finishing driver (within 3 km of their in-progress ride's drop) can accept a live broadcast that is held as a queued ride and auto-activated on completion, with real-time supervisor visibility. Tasks are ordered schema → eligibility → accept → promotion → routes/sockets → frontend → verify.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3", "4", "4.1"] },
    { "wave": 3, "tasks": ["5", "6"] },
    { "wave": 4, "tasks": ["7", "8"] },
    { "wave": 5, "tasks": ["9"] }
  ],
  "dependencies": {
    "3": ["1", "2"],
    "4": ["1", "2"],
    "4.1": ["1", "2"],
    "5": ["3", "4"],
    "6": ["3", "4"],
    "7": ["5", "6"],
    "8": ["5", "6"],
    "9": ["7", "8"]
  }
}
```

## Tasks

- [x] 1. Schema + migration: queued marker
  - Add `Ride.queuedBehindRideId String? @map("queued_behind_ride_id")` and `@@index([driverId, queuedBehindRideId])`. Add an additive migration creating the nullable column + index (idempotent `IF NOT EXISTS`). `prisma generate`.
  - _Requirements: 2.5_

- [x] 2. Dispatch constant
  - Add `FINISHING_DISTANCE_KM = 3` (in a small `dispatch.ts` or as a ride.service constant).
  - _Requirements: 1.1_

- [x] 3. Eligibility: admit finishing drivers, exclude queued-holders
  - Edit `findNearbyDrivers` and `nearbyDriversForRide`: replace the hard "on active ride" exclusion with the finishing-aware `NOT EXISTS` predicates from the design (active ride not started → excluded; in_progress within finishing distance → allowed; already holds a queued ride → excluded). Leave `vehicleAvailability` strict.
  - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [x] 4. Accept: queued assignment path
  - Edit `acceptRide`: after the credit gate, detect the driver's current active (non-queued) ride; if present and `in_progress` within finishing distance and no existing queued ride, assign the accepted ride with `queuedBehindRideId = active.id` and DEFER OTP SMS; if the driver already holds a queued ride throw `ConflictError`; if the active ride isn't finishing throw `ConflictError`. Idle-driver path unchanged. Return `{ queued }`.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.2_

- [x] 4.1 Manual assignment guard
  - Edit `manualAssignRide` to apply the same active-ride/finishing/queued/credit checks as `acceptRide`: no active ride → normal assign; finishing + no queued → queued assign (defer OTP); already queued or not finishing → reject.
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 5. Centralized promotion on any active-ride termination
  - Add `promoteQueuedRide(tx, terminatedRideId, driverId)` and call it inside the same transaction from every termination path: completion (`advanceRideStatus`, `maybeComplete`), supervisor cancel (`cancelRide`), driver-drop of the active ride (`driverCancelAssignedRide`), and sweeper expiry. After commit, run `sendPaxOtpSms(promotedRideId)` + supervisor socket emit exactly once. Credit consumption unchanged. Guarantees no orphaned queued marker.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 8.1, 8.2, 8.3, 6.3_

- [x] 6. Release / cancel a queued ride
  - Driver releasing a QUEUED ride (not the active one): return it to `broadcasting`, clear `queuedBehindRideId`, re-broadcast — via `driverCancelAssignedRide` detection or `POST /rides/:id/release-queued`. Supervisor cancelling a QUEUED ride: `cancelRide` sets `cancelled` and clears `queuedBehindRideId`. Distinguish "release queued ride" from "drop active ride while holding a queued ride" (task 5).
  - _Requirements: 4.1, 4.2_

- [x] 7. Realtime + payloads
  - Include `queuedBehindRideId` (+ derived `queued`) in `getRide`/`listRides` and the `/accept` response. Emit `ride:status_changed { queued, aheadRideId }` on queued accept, promotion, and release/cancel to the supervisor room + admin feed.
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 8. Frontend: driver + supervisor
  - Driver: during an in_progress ride within finishing distance, surface incoming broadcasts and an accept action; show the accepted "next ride" card; allow releasing it. Supervisor (Live/console): show a "Driver finishing another ride first" badge for queued rides and switch to normal active on the socket update.
  - _Requirements: 5.1, 5.2, 5.3, 2.1, 4.1_

- [x] 9. Verification
  - DB-backed tests for eligibility (finishing in, non-finishing out, queued-holder out), queued accept (marker set, OTP deferred, second accept rejected), promotion (clears marker, sends OTP once, burns one credit), cancel/expire promotion, supervisor-cancel clears marker, and a two-finishing-driver race. Backend typecheck + `vitest --run`; frontend typecheck + build.
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3, 3.1, 3.3, 3.5, 4.3, 6.1, 6.2, 6.3_

## Notes

- A queued ride reuses `status='assigned'` distinguished by `queuedBehindRideId` — do not add an enum value; audit each `assigned` query for whether it should include or exclude queued rides.
- Load-bearing invariants: at most one active + at most one queued ride per driver; promotion exactly once; one credit per completion. Guard with `FOR UPDATE` and the `queued_behind_ride_id` predicate.
- Escort/OTP/minimum-fare and ride-credit rules are unchanged.

