# Design Document

## Overview

The November 2026 load test against production (c6a.xlarge, 4 vCPU / 8 GB) showed that the server saturates at about 400-500 drivers who have the driver app open on screen. The limit is the CPU of the single API process (Node + Prisma). Postgres stayed under 20% CPU with at most 2 of 25 connections busy, and Redis stayed near 3%.

The load comes from the driver app polling, not from GPS pings or bookings. With the app open, each driver sends about 0.7 API requests per second, plus a GPS ping every 10-30 seconds:

| Query (src/lib/queries.ts) | Endpoint | Today |
|---|---|---|
| `useDriverOffers` | `GET /api/driver/offers` | 8 s |
| `useDriverRides` | `GET /api/driver/rides` | 8 s |
| `useDriverRentalsAvailable` | `GET /api/driver/rentals/available` | 8 s |
| `useDriverRentalsMine` | `GET /api/driver/rentals/mine` | 8 s |
| `useScheduledRides` | `GET /api/driver/scheduled` | 10 s |
| `useDriverSosIssues` | `GET /api/issues` | 10 s |

This design makes four changes. Together they aim to cut per-driver request volume by about 3.5-4x and API CPU per request, so the same server can serve the 3,000-driver target. The numbers are estimates until the load test is rerun.

1. **Event-driven driver app, with instant ride broadcasts.** Polling becomes a slow safety net. Live ride broadcasts are delivered over the socket and FCM the moment they happen, and the app polls offers fast again whenever its socket is down, so a broadcast is never left waiting for a 30 s poll.
2. **Clean, fast restarts.** Every deploy restarts the API. Shutdown currently waits about 12 s for open connections and hits the forced exit, so the final GPS flush is skipped. A faster restart also shortens the window in which a broadcast can be missed.
3. **Quiet logging on hot routes.** Stop writing one log line per successful GPS ping and poll.
4. **Short Redis cache for the scheduled-rides list.** It is the same list for every driver with the same vehicle type.

The driver APK loads the hosted web app (`capacitor.config.ts` uses `server.url = https://wekashi.in/driver`), so change 1 ships with a normal web deploy. No new APK is needed.

### Non-goals

- Running several API processes, or any multi-server or auto-scaling work.
- Changing supervisor or admin polling (50 consoles were not the bottleneck).
- Changing the native Android GPS service or the FCM payload.

## Architecture

```
BEFORE
  Driver app ---- every 8-10 s: offers, rides, rentals x2, scheduled, issues ----> API --> Postgres
  Server ---- ride:broadcast / ride:dismiss / issue:message ----> driver socket

AFTER
  Ride broadcast (createRide / rebroadcast / promotion / SOS rebook)
     1. RideOffer rows committed
     2. socket ride:broadcast  --> open app: offers refetched + ring, ~0.1-0.3 s
     3. FCM data push          --> backgrounded / killed app: native alert
  Driver app safety nets
     - socket connected:     offers poll every 30 s
     - socket NOT connected: offers poll every 8 s (same as today)
     - socket (re)connect:   refetch offers + all driver queries at once
     - app comes to front:   refetch offers at once
  Other driver data ---- every 30-60 s, plus instant refetch on:
         driver:rides_changed   (new, after any ride driver/status change)
         driver:rentals_changed (new, after a supervisor cancels a held rental)
         issue:message          (existing)
```

The existing correctness rule in `backend/src/lib/activeRideCache.ts` already requires every code path that changes a ride's `driver_id`, `status`, or `queued_behind_ride_id` to call `invalidateDriverActiveRide(...driverIds)` after commit. That function is therefore the single, already-audited place where "this driver's rides changed" is known. The new `driver:rides_changed` event is emitted from there, so no ride code path needs its own new emit.

## Components and Interfaces

### 1. Instant ride broadcasts (frontend + existing server path)

**Delivery path (server, unchanged).** `createRide`, rebroadcast, scheduled-to-broadcast promotion and SOS rebook all call `emitDriverBroadcast(io, driverIds, payload)` in `backend/src/lib/driverBroadcast.ts` after the `RideOffer` rows are committed. It emits `ride:broadcast` to room `driver:<id>` synchronously, then fires the FCM push without waiting for it. This path does not poll, so the interval changes below do not delay it. Fixes 2-4 lower API CPU, which makes the offers refetch triggered by the event faster under load.

**Socket connection state.** New module `src/lib/driverSocketState.ts`:

```ts
// Module-level store; one driver socket per app (useDriverBroadcastSocket).
export type DriverSocketState = "off" | "connected" | "disconnected";
export function setDriverSocketState(s: DriverSocketState): void;
export function useDriverSocketState(): DriverSocketState;   // useSyncExternalStore

export const OFFERS_POLL_CONNECTED_MS = 30_000;
export const OFFERS_POLL_DISCONNECTED_MS = 8_000;
export function offersPollInterval(s: DriverSocketState): number;   // 8 s only when "disconnected"
```

`useDriverBroadcastSocket` sets `disconnected` when it starts (driver online, socket not up yet), `connected` on `connect`, `disconnected` on `disconnect` and `connect_error`, and `off` in effect cleanup (driver offline). An offline driver therefore polls offers at 30 s, not 8 s.

**`useDriverOffers`** uses `refetchInterval: offersPollInterval(useDriverSocketState())` and keeps `refetchOnWindowFocus: true`. React Query's focus manager listens to `visibilitychange`, so bringing the app to the front refetches offers at once. While the socket is down (network blip, server restart, reconnect backoff) the app polls offers every 8 s, as it does today. While the socket is up, broadcasts arrive instantly and the 30 s poll only reconciles.

**`src/lib/driverRideAlerts.ts`** (`useDriverBroadcastSocket`) handlers on the existing driver socket:

| Event | Action |
|---|---|
| `ride:broadcast` (existing) | `refetchQueries(["driver","offers"])`, ring and vibrate. Unchanged. |
| `ride:dismiss` (existing) | `refetchQueries(["driver","offers"])`. Unchanged. |
| `connect` (first connect and every reconnect) | mark connected; `refetchQueries(["driver","offers"])`; `invalidateQueries(["driver"])` and `["driverSos"]`. Catches any broadcast missed while disconnected. |
| `disconnect`, `connect_error` | mark not connected (offers fall back to 8 s). |
| `driver:rides_changed` (new) | `refetchQueries(["driver","rides"])` and `["driver","scheduled"]`. |
| `driver:rentals_changed` (new) | `refetchQueries(["driver","rentals"])` (available and mine). |
| `issue:message` (existing server event) | `refetchQueries(["driverSos"])`. |

All handlers are removed in the effect cleanup, as the existing ones are.

**Other intervals in `src/lib/queries.ts`:**

| Query | Today | New | Why it is safe |
|---|---|---|---|
| `useDriverRides` | 8 s | 30 s | `driver:rides_changed` refetches it instantly (assignment, queued promotion, cancel, manual assign). |
| `useDriverRentalsMine` | 8 s | 30 s | The driver's own accept/start/complete already invalidate it locally; `driver:rentals_changed` covers a supervisor cancel. |
| `useDriverRentalsAvailable` | 8 s | 30 s | Rentals are booked in advance and also reach drivers by push; a 30 s delay in the list is acceptable. |
| `useScheduledRides` | 10 s | 60 s | Claimable only more than 4 h ahead; a claim race is already guarded by `FOR UPDATE SKIP LOCKED`. |
| `useDriverSosIssues` | 10 s | 30 s | `issue:message` refetches it instantly. |

Polls that run only on a trip screen (`/rides/:id/pax` at 6 s, rental progress at 5 s) are left unchanged. React Query pauses `refetchInterval` while the WebView is hidden, so backgrounded drivers keep sending only GPS pings.

Known gap: the socket is only open while the driver is online (`useDriverBroadcastSocket(online, ...)` in `DriverShell.tsx`). An offline driver receives no offers, so the slow polls are enough there.

### 2. Server: driver change events

**`backend/src/lib/activeRideCache.ts`**

```ts
type DriverNotifier = (driverIds: string[]) => void;
let notifier: DriverNotifier | null = null;

/** Called once from server.ts after Socket.IO is created. */
export function setDriverRidesNotifier(fn: DriverNotifier | null): void;

export async function invalidateDriverActiveRide(...driverIds): Promise<void> {
  // existing: drop null/undefined, redis.del(keys)
  // new: de-dupe, then notifier?.(uniqueIds) inside try/catch; never throws
}
```

`server.ts` registers the notifier, which emits `driver:rides_changed` (empty payload) to room `driver:<id>` on the `/driver` namespace for each id. The emit goes through the existing Redis adapter, so it already works with more than one instance. Injecting the function keeps Socket.IO out of `activeRideCache.ts`, so it stays unit-testable.

**`backend/src/services/rental.service.ts`** - `cancelRental(rentalId, supervisorId)` already notifies the driver holding the rental. It also calls an injected `driverRentalsNotifier` (set from `server.ts` with `setDriverRentalsNotifier`), which emits `driver:rentals_changed` to that driver.

### 3. Fast, clean shutdown

**`backend/src/server.ts`** `shutdown()` - new order:

1. Stop all sweepers and the location flusher timer (unchanged).
2. Disconnect local sockets on `/driver`, `/supervisor`, `/admin` (already added). Clients reconnect to the new process on their own.
3. `httpServer.close(...)`, then `httpServer.closeIdleConnections()` at once and `httpServer.closeAllConnections()` after 3 s. Node 22 supports both. Idle keep-alive connections from nginx's upstream pool were what kept `close()` waiting.
4. In the close callback: final `flushLocationBuffer()`, `prisma.$disconnect()`, `redis.disconnect()`, log `Graceful shutdown complete`, exit 0.
5. Forced exit stays as a safety net, moved from 10 s to 15 s.

**`docker-compose.demo.yml`** - `api` gets `stop_grace_period: 20s` (the Docker default of 10 s would SIGKILL before the 15 s safety net).

### 4. Quiet logging on hot routes

New module **`backend/src/lib/httpLogLevel.ts`**, used by `pinoHttp({ customLogLevel })` in `backend/src/app.ts`:

```ts
const QUIET_ROUTES: RegExp[] = [
  /^\/health$/,
  /^\/api\/driver\/location$/,
  /^\/api\/driver\/(offers|rides|scheduled|credits|stats)$/,
  /^\/api\/driver\/rentals\/(available|mine)$/,
  /^\/api\/issues$/,
];

export function httpLogLevel(url: string, statusCode: number, err?: unknown): pino.LevelWithSilent {
  const path = url.split('?')[0];
  if (err || statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return QUIET_ROUTES.some((r) => r.test(path)) ? 'silent' : 'info';
}
```

Errors and 4xx responses on quiet routes are still logged.

### 5. Redis cache for `/driver/scheduled`

**`backend/src/lib/scheduledCache.ts`** (new; `scheduledCacheKey`, `cachedScheduledList`, `invalidateScheduledCache`), used by `listScheduledRidesForDriver(vehicleType)` in `ride.service.ts` and by the airport-ride service. A separate module avoids a circular import and keeps it testable with only Redis mocked:

- Key `cache:scheduled:<vehicleType or "any">`, TTL 10 s, value is the JSON of the built list. The prefix does not collide with `dpos:`, `trail:`, `activeride:`, `ride:broadcast:` or `driver:blocked:`.
- Hit: return the parsed value. Miss or any Redis error: query Postgres as today, then write the cache best-effort (fails open, like `activeRideCache`).
- Invalidation: after a scheduled ride is created, claimed (`claimScheduledRide`), released (`driverReleaseScheduledRide`), cancelled, or promoted to broadcasting (`sweepStaleScheduledRides`), delete all `cache:scheduled:*` keys (SCAN + DEL, a handful of keys). The TTL bounds staleness for any missed path.
- Dates round-trip as ISO strings, which is what the route already sends as JSON, so the response body is unchanged. OTP stripping still happens in the route after the service call.

This cache only covers the scheduled marketplace. Live broadcast offers (`/driver/offers`) are never cached.

## Data Models

No database schema changes and no migrations.

| Redis key | Value | TTL |
|---|---|---|
| `cache:scheduled:<vehicleType or any>` | JSON array of scheduled rides | 10 s |

| Socket.IO event (`/driver`, room `driver:<id>`) | Payload | Emitted when |
|---|---|---|
| `driver:rides_changed` | `{}` | After any `invalidateDriverActiveRide(id)` |
| `driver:rentals_changed` | `{}` | After a supervisor cancels a rental the driver holds |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system - essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Offers poll fast whenever the socket is down

*For any* sequence of socket state changes, `offersPollInterval` of the current state returns 8,000 ms exactly when the state is `disconnected` (online, socket down) and 30,000 ms otherwise.

**Validates: Requirements 1.3, 1.4**

### Property 2: Every invalidated driver is notified exactly once

*For any* list of arguments passed to `invalidateDriverActiveRide` (including duplicates, `null` and `undefined`), the registered notifier is called with exactly the set of distinct non-empty driver ids, each once. If that set is empty, the notifier is not called.

**Validates: Requirements 2.1**

### Property 3: Notifier failures never break ride flows

*For any* notifier that throws, `invalidateDriverActiveRide` still resolves and the Redis keys are still deleted.

**Validates: Requirements 2.2**

### Property 4: Hot-route log suppression keeps every failure

*For any* URL and status code, `httpLogLevel` returns `'error'` when the status is 500 or above or an error is present, `'warn'` for 400-499, `'silent'` only when the status is below 400 and the path (without query string) matches a quiet route, and `'info'` otherwise.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

### Property 5: Scheduled cache round-trip equals a fresh read

*For any* list of scheduled rides returned by the database query, the value returned on a cache hit is deep-equal to `JSON.parse(JSON.stringify(list))`, which is the body the route sends on a cache miss.

**Validates: Requirements 5.2**

### Property 6: Cache keys stay outside scanned prefixes

*For any* vehicle type (including null and empty string), the cache key starts with `cache:scheduled:` and never starts with `dpos:`, `trail:` or `activeride:`.

**Validates: Requirements 5.5**

## Error Handling

| Failure | Behavior |
|---|---|
| Socket down when a ride is broadcast | FCM push still alerts the phone; offers poll every 8 s while disconnected; on reconnect offers are refetched at once. |
| Socket event missed for other data | The 30-60 s poll reconciles; reconnect refetches all driver queries. |
| Notifier throws or emit fails | Caught and logged at `warn`. The ride change already committed. |
| Redis down (scheduled cache) | Errors caught; request falls through to Postgres. |
| Final flush slow at shutdown | `closeAllConnections` at 3 s lets the callback run; forced exit at 15 s and Docker grace at 20 s remain. |

## Testing Strategy

**Unit and property tests** (backend vitest and frontend vitest, with `fast-check` added as a dev dependency). None of them need Postgres or Redis.

- `offersPollInterval` (Property 1).
- `invalidateDriverActiveRide` notifier with Redis mocked (Properties 2, 3).
- `httpLogLevel` with generated URLs, query strings, status codes 100-599, with and without errors (Property 4).
- Scheduled cache with Redis and Prisma mocked (Properties 5, 6).

**Frontend:** type-check and build.

**Load test (acceptance):** update `scripts/loadtest/full.k6.js` to the new intervals (offers, rides, rentals x2 and issues every 30 s; scheduled every 60 s) and add a broadcast-latency probe: a real test driver account holds a socket during the test, and a supervisor creates one test ride by hand in a quiet hour. Latency is the receive time minus the broadcast start (`broadcast_expires_at` in the payload minus the 60 s auction window). Rerun the stepped test against production with live SSH monitoring.

| Measure | Before | Target |
|---|---|---|
| Drivers with app open at p95 under 1 s | ~300 | 1,500 or more |
| Socket `ride:broadcast` to offers visible on the driver screen | not measured | under 1 s at target load |
| API restart: shutdown log | Forced shutdown after 10 s | Graceful shutdown complete in under 5 s |
| Log lines per successful GPS ping | 1 | 0 |
| HTTP 5xx with 3,000 sockets connected | 0 | 0 |

If the capacity target is not met, the next lever is running 2-3 API processes, outside this spec.