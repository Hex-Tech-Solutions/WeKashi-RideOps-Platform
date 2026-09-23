# Requirements Document

## Introduction

This feature lets a driver who is near the end of their current ride accept a new live broadcast and have it **queued** as their next ride. When the current ride completes, the queued ride is automatically activated (assigned) to the driver, and the normal ride flow continues from there. The supervisor console shows, in real time, when a driver has a queued next ride and its status.

Today a driver on an `assigned` or `in_progress` ride is excluded from all new broadcasts (the dispatch invariant is "one active ride per driver"). This feature relaxes that invariant in a controlled way: a driver becomes eligible for new broadcasts only when they are within a configurable finishing distance of their current ride's final drop, and may hold at most one queued ride.

All existing rules are preserved: ride-credit eligibility, one-credit-per-completed-ride consumption, escort/OTP flows, and the ₹500 minimum fare are unchanged.

## Glossary

- **Active_Ride**: The ride a driver is currently serving (`assigned` or `in_progress`).
- **Queued_Ride**: A broadcast ride the driver has accepted while still serving their Active_Ride; it waits until the Active_Ride completes.
- **Finishing_Window**: The condition under which a driver becomes eligible for new broadcasts while still on an Active_Ride — the driver's current location is within the Finishing_Distance of the Active_Ride's final drop point.
- **Finishing_Distance**: The straight-line distance threshold (default 3 km) that opens the Finishing_Window.
- **Final_Drop**: The last drop point of the Active_Ride (the ride-level drop for the last remaining passenger/office).
- **Ride_Credit**: A unit consumed on ride completion; gates broadcast eligibility (existing feature).
- **Broadcast**: A live ride offer sent to nearby eligible drivers (existing feature).
- **Dispatch**: The platform logic that selects eligible drivers for a broadcast.

## Requirements

### Requirement 1: Eligibility for a next-ride broadcast while finishing

**User Story:** As a Driver about to finish a ride, I want to receive new broadcasts when I'm close to my drop, so that I can line up my next ride and avoid idle time.

#### Acceptance Criteria

1. WHILE a Driver's Active_Ride is `in_progress` AND the Driver's current location is within the Finishing_Distance of the Final_Drop, THE RideOps_Platform SHALL treat the Driver as eligible to receive new Broadcasts, in addition to the existing online/active/KYC/vehicle-type/credit criteria.
2. WHILE a Driver's Active_Ride is `in_progress` AND the Driver is NOT within the Finishing_Distance of the Final_Drop, THE RideOps_Platform SHALL exclude the Driver from new Broadcasts.
3. WHILE a Driver already holds a Queued_Ride, THE RideOps_Platform SHALL exclude the Driver from new Broadcasts (at most one Queued_Ride).
4. WHERE a Driver has zero available Ride_Credits, THE RideOps_Platform SHALL exclude the Driver from next-ride Broadcasts regardless of the Finishing_Window.
5. THE RideOps_Platform SHALL continue to exclude a Driver whose Active_Ride is `assigned` (trip not yet started) from next-ride Broadcasts — the Finishing_Window applies only to `in_progress` rides.

### Requirement 2: Accept a broadcast as a queued ride

**User Story:** As a Driver in the Finishing_Window, I want to accept a broadcast, so that it becomes my next ride once I finish the current one.

#### Acceptance Criteria

1. WHEN a Driver in the Finishing_Window accepts a Broadcast, THE RideOps_Platform SHALL assign that ride to the Driver as a Queued_Ride and remove it from the Broadcast marketplace, exactly as a normal accept does.
2. WHEN a Driver accepts a Broadcast as a Queued_Ride, THE RideOps_Platform SHALL NOT change the state of the Driver's Active_Ride.
3. IF a Driver who already holds a Queued_Ride attempts to accept another Broadcast, THEN THE RideOps_Platform SHALL reject the accept with a clear message.
4. WHEN a Driver accepts a Broadcast as a Queued_Ride, THE RideOps_Platform SHALL apply the same credit eligibility check used for a normal accept (at least one available Ride_Credit).
5. WHEN a Broadcast is accepted as a Queued_Ride, THE RideOps_Platform SHALL record that the ride is queued behind the Driver's current Active_Ride.

### Requirement 3: Auto-activate the queued ride on completion

**User Story:** As a Driver, I want my queued ride to become active automatically when I finish the current ride, so that I don't have to re-accept it.

#### Acceptance Criteria

1. WHEN a Driver's Active_Ride transitions to `completed`, THE RideOps_Platform SHALL activate the Driver's Queued_Ride so it becomes the Driver's new Active_Ride and proceeds through the normal ride flow.
2. WHEN a Queued_Ride is activated, THE RideOps_Platform SHALL clear its queued marker so it is a normal Active_Ride with no special state.
3. WHEN a Queued_Ride is activated, THE RideOps_Platform SHALL trigger the same post-assignment side effects a normal assignment triggers (e.g. passenger OTP notifications), exactly once.
4. WHERE a Driver has no Queued_Ride when their Active_Ride completes, THE RideOps_Platform SHALL complete the ride normally with no additional action.
5. WHEN the Active_Ride completes, THE RideOps_Platform SHALL consume exactly one Ride_Credit for that completed ride as it does today, independent of any Queued_Ride.

### Requirement 4: Release or cancel a queued ride

**User Story:** As a Driver, I want to give up a queued ride if my plans change, so that it can go to another driver.

#### Acceptance Criteria

1. WHEN a Driver releases their Queued_Ride before it activates, THE RideOps_Platform SHALL return that ride to the Broadcast marketplace and clear the Driver's Queued_Ride, without affecting the Active_Ride and without any penalty.
2. WHEN a Supervisor cancels a ride that is currently a Driver's Queued_Ride, THE RideOps_Platform SHALL cancel that ride and clear the Driver's queued marker, without affecting the Active_Ride.
3. IF the Active_Ride is itself cancelled or expired before completion WHILE a Queued_Ride exists, THEN THE RideOps_Platform SHALL activate the Queued_Ride as the Driver's Active_Ride (the Driver is now free to serve it).

### Requirement 5: Supervisor real-time visibility of queued rides

**User Story:** As a Supervisor, I want to see when the driver assigned to my ride has it queued behind another ride, so that I know when to expect them.

#### Acceptance Criteria

1. WHEN a Driver accepts a Supervisor's Broadcast as a Queued_Ride, THE RideOps_Platform SHALL show that ride in the Supervisor console as assigned-but-queued, distinct from a normally-assigned ride, in real time.
2. WHILE a ride is a Queued_Ride, THE RideOps_Platform SHALL display to the Supervisor that the assigned Driver is finishing another ride first.
3. WHEN a Queued_Ride activates (the Driver's prior ride completes), THE RideOps_Platform SHALL update the Supervisor console in real time to show the ride as normally active.
4. WHERE a Queued_Ride is released or cancelled, THE RideOps_Platform SHALL update the Supervisor console in real time to reflect the change.

### Requirement 7: Manual assignment respects the one-active-ride invariant

**User Story:** As a Supervisor manually assigning a driver, I want the platform to never double-book a busy driver, so that a manual assign can't break the queueing rules.

#### Acceptance Criteria

1. WHEN a Supervisor or Admin manually assigns a ride to a Driver who has no Active_Ride, THE RideOps_Platform SHALL assign it as a normal Active_Ride (unchanged behavior).
2. WHEN a Supervisor or Admin manually assigns a ride to a Driver whose Active_Ride is `in_progress` and within the Finishing_Window and who holds no Queued_Ride, THE RideOps_Platform SHALL assign it as a Queued_Ride.
3. IF a Supervisor or Admin manually assigns a ride to a Driver who already holds a Queued_Ride, OR whose Active_Ride is not in the Finishing_Window, THEN THE RideOps_Platform SHALL reject the assignment with a clear message.
4. WHEN a ride is manually assigned as a Queued_Ride, THE RideOps_Platform SHALL apply the same credit eligibility check as a broadcast accept.

### Requirement 8: Terminating the active ride resolves its queued ride

**User Story:** As a Driver, if my current ride ends in any way, I want my queued ride to become active so I'm never stuck holding a ride I can't start.

#### Acceptance Criteria

1. WHEN a Driver's Active_Ride is `completed`, `cancelled`, or `expired` WHILE a Queued_Ride exists, THE RideOps_Platform SHALL activate the Queued_Ride as the Driver's new Active_Ride.
2. WHEN a Driver drops (releases) their Active_Ride WHILE a Queued_Ride exists, THE RideOps_Platform SHALL activate the Queued_Ride as the Driver's new Active_Ride.
3. THE RideOps_Platform SHALL never leave a Queued_Ride pointing at a ride that is no longer the Driver's Active_Ride (no orphaned queued marker).

### Requirement 6: Preserve existing invariants

**User Story:** As the platform operator, I want next-ride queueing to not weaken existing guarantees, so that dispatch and billing remain correct.

#### Acceptance Criteria

1. THE RideOps_Platform SHALL ensure a Driver serves at most one Active_Ride at any time (a Queued_Ride is not served until the Active_Ride completes).
2. THE RideOps_Platform SHALL ensure a Broadcast is won by exactly one Driver, whether accepted normally or as a Queued_Ride.
3. THE RideOps_Platform SHALL consume exactly one Ride_Credit per completed ride, counting the Active_Ride and a later-activated Queued_Ride as separate completions.
4. THE RideOps_Platform SHALL leave escort logic, escort-OTP flows, and the ₹500 minimum fare unchanged.
