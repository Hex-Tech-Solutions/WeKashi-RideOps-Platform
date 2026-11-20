# Requirements Document

## Introduction

The November 2026 production load test showed the single API server saturates at about 400-500 drivers with the driver app open, because the app polls six endpoints every 8-10 seconds. This feature cuts that load so one c6a.xlarge can serve the 3,000-driver target, while keeping live ride broadcasts instant for drivers. It also makes API restarts clean and fast, removes per-request log lines on hot routes, and caches the scheduled-rides list briefly.

## Glossary

- **Driver_App**: the driver web app at `https://wekashi.in/driver`, also loaded inside the Android APK.
- **Server**: the RideOps API (`backend/`).
- **Driver_Socket**: the Socket.IO connection the Driver_App opens on the `/driver` namespace while the driver is online.
- **Ride_Broadcast**: the moment a ride is offered to selected drivers, after its `RideOffer` rows are committed (ride creation, rebroadcast, scheduled-to-live promotion, SOS rebook).
- **Offers_List**: the driver's list of live ride offers (`GET /api/driver/offers`).
- **Quiet_Route**: an endpoint whose successful responses are not logged: `/health`, `/api/driver/location`, `/api/driver/offers`, `/api/driver/rides`, `/api/driver/scheduled`, `/api/driver/credits`, `/api/driver/stats`, `/api/driver/rentals/available`, `/api/driver/rentals/mine`, `/api/issues`.
- **Scheduled_Cache**: the Redis cache of the scheduled-rides list, keyed per vehicle type.
- **Foreground_Driver**: a driver with the Driver_App open on screen.

## Requirements

### Requirement 1: Instant ride broadcasts

**User Story:** As a driver, I want to see a new ride the moment it is broadcast, so that I can accept it before the one-minute auction window closes.

#### Acceptance Criteria

1. WHEN a Ride_Broadcast happens, THE Server SHALL emit `ride:broadcast` to each selected driver's Driver_Socket room before sending the FCM push.
2. WHEN the Driver_App receives `ride:broadcast`, THE Driver_App SHALL refetch the Offers_List immediately and play the ride alert.
3. WHILE the Driver_Socket is connected, THE Driver_App SHALL poll the Offers_List every 30 seconds.
4. WHILE the driver is online and the Driver_Socket is not connected, THE Driver_App SHALL poll the Offers_List every 8 seconds.
5. WHEN the Driver_Socket connects or reconnects, THE Driver_App SHALL refetch the Offers_List and all other driver queries immediately.
6. WHEN the Driver_App returns to the foreground, THE Driver_App SHALL refetch the Offers_List immediately.
7. WHEN the Driver_App receives `ride:dismiss`, THE Driver_App SHALL refetch the Offers_List immediately so the ride card disappears.
8. WHERE FCM is configured, THE Server SHALL send the ride push for every Ride_Broadcast without waiting for it to finish.
9. THE Server SHALL NOT cache the Offers_List.

### Requirement 2: Event-driven driver data

**User Story:** As a driver, I want my rides, rentals and SOS chat to update as soon as they change, so that I don't act on stale information while the app polls less often.

#### Acceptance Criteria

1. WHEN `invalidateDriverActiveRide` is called, THE Server SHALL emit `driver:rides_changed` exactly once to each distinct non-empty driver id passed to it.
2. IF emitting `driver:rides_changed` fails, THEN THE Server SHALL log a warning and complete the ride operation normally.
3. WHEN the Driver_App receives `driver:rides_changed`, THE Driver_App SHALL refetch the driver's rides and scheduled rides immediately.
4. WHEN a supervisor cancels a rental that a driver holds, THE Server SHALL emit `driver:rentals_changed` to that driver.
5. WHEN the Driver_App receives `driver:rentals_changed`, THE Driver_App SHALL refetch the available and held rentals immediately.
6. WHEN the Driver_App receives `issue:message`, THE Driver_App SHALL refetch the driver's issues immediately.
7. THE Driver_App SHALL poll the driver's rides, available rentals, held rentals and issues every 30 seconds, and scheduled rides every 60 seconds.
8. THE Driver_App SHALL keep the existing poll intervals for ride passengers and rental progress on trip screens.

### Requirement 3: Clean, fast API restarts

**User Story:** As the operator, I want every deploy to restart the API quickly and cleanly, so that drivers reconnect fast and no GPS positions are lost.

#### Acceptance Criteria

1. WHEN the Server receives SIGTERM or SIGINT, THE Server SHALL stop all sweepers and disconnect all local Driver_Socket, supervisor and admin sockets.
2. WHEN shutdown starts, THE Server SHALL close idle HTTP connections immediately and close all remaining HTTP connections after 3 seconds.
3. WHEN all HTTP connections are closed, THE Server SHALL flush the location buffer, disconnect Postgres and Redis, log `Graceful shutdown complete`, and exit with code 0.
4. IF shutdown has not completed after 15 seconds, THEN THE Server SHALL log `Forced shutdown after timeout` and exit with code 1.
5. THE `api` service in `docker-compose.demo.yml` SHALL allow a stop grace period of 20 seconds.

### Requirement 4: Quiet logging on hot routes

**User Story:** As the operator, I want the server to stop logging every successful GPS ping and poll, so that CPU is spent on serving drivers while errors stay visible.

#### Acceptance Criteria

1. WHEN a request to a Quiet_Route completes with a status below 400 and no error, THE Server SHALL NOT write an HTTP log line for it.
2. WHEN any request completes with a status from 400 to 499, THE Server SHALL log it at warn level.
3. WHEN any request completes with a status of 500 or above, or with an error, THE Server SHALL log it at error level.
4. THE Server SHALL match Quiet_Routes on the request path without its query string, and log all other successful requests at info level.

### Requirement 5: Scheduled-rides cache

**User Story:** As the operator, I want the scheduled-rides list cached briefly, so that thousands of drivers don't rebuild the same list from Postgres.

#### Acceptance Criteria

1. WHEN a driver requests scheduled rides, THE Server SHALL return the Scheduled_Cache entry for the driver's vehicle type if one exists, and otherwise build the list from Postgres and store it for 10 seconds.
2. THE Server SHALL return the same response body for a Scheduled_Cache hit as for a fresh build.
3. WHEN a scheduled ride is created, claimed, released, cancelled, or promoted to a live broadcast, THE Server SHALL delete all Scheduled_Cache entries.
4. IF Redis is unavailable, THEN THE Server SHALL build the scheduled-rides list from Postgres and return it without error.
5. THE Server SHALL store Scheduled_Cache entries under the `cache:scheduled:` key prefix only.

### Requirement 6: Capacity and latency verification

**User Story:** As the operator, I want a load test that proves the changes worked, so that I can decide on infrastructure from real numbers.

#### Acceptance Criteria

1. THE load test script SHALL simulate Foreground_Drivers using the new poll intervals from Requirements 1 and 2.
2. WHEN the load test runs against production, THE Server SHALL serve at least 1,500 Foreground_Drivers with 95% of requests completing in under 1 second.
3. WHILE 3,000 Driver_Sockets are connected, THE Server SHALL return no HTTP 5xx responses.
4. WHEN a test ride is broadcast during the load test, THE Driver_App test account SHALL receive `ride:broadcast` within 1 second of the broadcast start.
5. WHEN the API is restarted during the load test, THE Server SHALL log `Graceful shutdown complete` within 5 seconds of SIGTERM.