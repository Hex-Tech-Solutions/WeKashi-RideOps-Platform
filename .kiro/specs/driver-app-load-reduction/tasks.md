# Implementation Plan: Driver App Load Reduction

## Overview

Cut driver-app request volume and API CPU per request so one c6a.xlarge serves the 3,000-driver target, while ride broadcasts stay instant. Backend is TypeScript (Express, Prisma, Socket.IO, ioredis) in `backend/`; frontend is the React + React Query app in `src/`. Property tests use vitest with `fast-check` and must not need Postgres or Redis.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1.1", "2.1", "4.1", "6.1"] },
    { "wave": 2, "tasks": ["1.2", "3.1", "6.2", "6.3"] },
    { "wave": 3, "tasks": ["3.2", "3.3", "4.2", "6.4"] },
    { "wave": 4, "tasks": ["5", "7", "8.1"] },
    { "wave": 5, "tasks": ["9"] }
  ],
  "dependencies": {
    "1.2": ["1.1"],
    "3.1": ["2.1"],
    "3.2": ["3.1", "1.2"],
    "3.3": ["3.1"],
    "4.2": ["4.1", "1.2"],
    "6.2": ["6.1"],
    "6.3": ["6.1"],
    "6.4": ["6.1"],
    "5": ["1.2", "2.1", "3.2", "3.3", "4.2"],
    "7": ["6.2", "6.3", "6.4"],
    "8.1": ["6.4"],
    "9": ["5", "7", "8.1"]
  }
}
```

## Tasks

- [x] 1. Quiet logging on hot routes
  - [x] 1.1 Create `backend/src/lib/httpLogLevel.ts` and use it in `backend/src/app.ts`
    - Export `QUIET_ROUTES` and `httpLogLevel(url, statusCode, err?)` exactly as in the design (strip the query string; error/5xx -> 'error', 4xx -> 'warn', quiet + <400 -> 'silent', else 'info')
    - Replace the inline `customLogLevel` in `pinoHttp(...)` with `(req, res, err) => httpLogLevel(req.originalUrl ?? req.url, res.statusCode, err)`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 1.2 Write property test for `httpLogLevel` in `backend/tests/http-log-level.unit.test.ts`
    - Add `fast-check` to backend devDependencies
    - **Property 4: Hot-route log suppression keeps every failure**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 2. Fast, clean API shutdown
  - [x] 2.1 Update `shutdown()` in `backend/src/server.ts` and the compose file
    - Keep the existing sweeper stops and per-namespace `disconnectSockets(true)`
    - After `httpServer.close(cb)`, call `httpServer.closeIdleConnections()` at once and `httpServer.closeAllConnections()` after 3 s (timer `.unref()`)
    - In the close callback keep final flush, Prisma/Redis disconnect, log `Graceful shutdown complete`, exit 0
    - Move the forced exit from 10 s to 15 s
    - Add `stop_grace_period: 20s` to the `api` service in `docker-compose.demo.yml`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Server events for driver data changes
  - [x] 3.1 Add the rides notifier to `backend/src/lib/activeRideCache.ts` and register it in `server.ts`
    - `setDriverRidesNotifier(fn | null)`; in `invalidateDriverActiveRide`, de-dupe non-empty ids, delete keys as today, then call the notifier inside try/catch (log warn on failure, never throw)
    - In `server.ts`, after `initSockets`, register a notifier that emits `driver:rides_changed` with `{}` to room `driver:<id>` on `/driver` for each id
    - _Requirements: 2.1, 2.2_
  - [x] 3.2 Write property tests for the rides notifier in `backend/tests/active-ride-notifier.unit.test.ts`
    - Mock `../src/lib/redis` and `../src/lib/prisma`
    - **Property 2: Every invalidated driver is notified exactly once**
    - **Validates: Requirements 2.1**
    - **Property 3: Notifier failures never break ride flows**
    - **Validates: Requirements 2.2**
  - [x] 3.3 Emit `driver:rentals_changed` when a supervisor cancels a held rental
    - Add `setDriverRentalsNotifier(fn | null)` to `backend/src/services/rental.service.ts`; call it in `cancelRental` for the driver who held an assigned or in-progress rental, inside try/catch
    - Register it in `server.ts` to emit `driver:rentals_changed` with `{}` to `driver:<id>` on `/driver`
    - _Requirements: 2.4_

- [x] 4. Scheduled-rides Redis cache
  - [x] 4.1 Cache `listScheduledRidesForDriver` in `backend/src/services/ride.service.ts`
    - Export `scheduledCacheKey(vehicleType)` returning `cache:scheduled:<vehicleType or "any">`; TTL 10 s; store `JSON.stringify(list)`, return the parsed value on a hit
    - Fail open: any Redis read/write error falls through to the existing Postgres query
    - Export `invalidateScheduledCache()` (SCAN `cache:scheduled:*` + DEL, errors swallowed and logged) and call it after a scheduled ride is created, claimed (`claimScheduledRide`), released (`driverReleaseScheduledRide`), cancelled, and promoted in `sweepStaleScheduledRides`
    - Do not cache `/driver/offers`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 1.9_
  - [x] 4.2 Write property tests for the scheduled cache in `backend/tests/scheduled-cache.unit.test.ts`
    - Mock Redis (in-memory map) and Prisma
    - **Property 5: Scheduled cache round-trip equals a fresh read**
    - **Validates: Requirements 5.2**
    - **Property 6: Cache keys stay outside scanned prefixes**
    - **Validates: Requirements 5.5**

- [x] 5. Checkpoint - backend
  - Run `npx tsc --noEmit` in `backend/` and the DB-free unit tests including the three new test files; ensure all pass, ask the user if questions arise.

- [x] 6. Driver app: instant broadcasts and event-driven refresh
  - [x] 6.1 Create `src/lib/driverSocketState.ts`
    - Module-level store with `setDriverSocketConnected`, `useDriverSocketConnected` (`useSyncExternalStore`), `OFFERS_POLL_CONNECTED_MS = 30_000`, `OFFERS_POLL_DISCONNECTED_MS = 8_000`, `offersPollInterval(connected)`
    - _Requirements: 1.3, 1.4_
  - [x] 6.2 Write property test for `offersPollInterval` in `src/lib/driverSocketState.test.ts`
    - Add `fast-check` to the root devDependencies
    - **Property 1: Offers poll fast whenever the socket is down**
    - **Validates: Requirements 1.3, 1.4**
  - [x] 6.3 Add socket handlers in `src/lib/driverRideAlerts.ts`
    - Keep `ride:broadcast` and `ride:dismiss` handling unchanged
    - `connect`: mark connected, refetch `["driver","offers"]`, invalidate `["driver"]` and `["driverSos"]`
    - `disconnect` and `connect_error`: mark not connected; also mark not connected in effect cleanup
    - `driver:rides_changed`: refetch `["driver","rides"]` and `["driver","scheduled"]`
    - `driver:rentals_changed`: refetch `["driver","rentals"]`
    - `issue:message`: refetch `["driverSos"]`
    - Remove every handler in cleanup
    - _Requirements: 1.2, 1.5, 1.7, 2.3, 2.5, 2.6_
  - [x] 6.4 Change poll intervals in `src/lib/queries.ts`
    - `useDriverOffers`: `refetchInterval: offersPollInterval(useDriverSocketConnected())`, `refetchOnWindowFocus: true`
    - `useDriverRides`, `useDriverRentalsAvailable`, `useDriverRentalsMine`, `useDriverSosIssues`: 30 s; `useScheduledRides`: 60 s
    - Leave `useRidePax` (6 s) and `useRentalProgress` (5 s) unchanged
    - _Requirements: 1.3, 1.4, 1.6, 2.7, 2.8_

- [x] 7. Checkpoint - frontend
  - Run `npx tsc --noEmit -p tsconfig.app.json`, the new frontend test, and `npx vite build`; ensure all pass, ask the user if questions arise.

- [x] 8. Update the load test to the new behaviour
  - [x] 8.1 Update `scripts/loadtest/full.k6.js`
    - Driver scenario: offers, rides, rentals x2 and issues every 30 s; scheduled every 60 s; GPS every 10 s (split into per-interval scenarios or weighted per cycle so per-driver request rates match)
    - Keep the 3,000-socket scenario, safety brake, and per-endpoint thresholds
    - Add an optional `BROADCAST_PROBE=1` scenario: one real-driver socket that records `broadcast_latency_ms` = receive time minus (`broadcast_expires_at` - 60 s) for each `ride:broadcast`, with threshold p95 < 1000
    - _Requirements: 6.1, 6.4_

- [x] 9. Final checkpoint
  - Ensure backend and frontend checks pass and `k6 inspect scripts/loadtest/full.k6.js` succeeds; do not commit or push. Ask the user if questions arise.

## Notes

- Deploying and rerunning the load test against production (Requirements 6.2, 6.3, 6.5) is done afterwards with the user, in a quiet hour.
- Property tests validate the six correctness properties in the design.