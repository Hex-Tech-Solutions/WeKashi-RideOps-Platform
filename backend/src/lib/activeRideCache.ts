import { redis } from './redis';
import { prisma } from './prisma';
import { logger } from './logger';

/**
 * Short-lived Redis cache of "which ride is this driver on right now?".
 *
 * updateDriverLocation() runs on every GPS ping (thousands per minute at scale)
 * and used to hit Postgres each time just to learn that most drivers are idle.
 * This cache turns that into a single Redis read.
 *
 * Correctness model:
 *   - Every code path that changes a ride's driver_id / status (or promotes a
 *     queued ride) calls invalidateDriverActiveRide() AFTER its transaction
 *     commits, so the next ping re-reads the database.
 *   - The TTL is a safety net for any path that is missed: the worst case is a
 *     stale answer for TTL seconds, never a permanent one.
 *   - Fails open: any Redis error falls back to a direct database read.
 *
 * Key prefix is deliberately NOT `dpos:` or `trail:` (locationBuffer scans those).
 */

const KEY_PREFIX = 'activeride:';
const TTL_SECONDS = 60;
const NONE = '0'; // sentinel for "driver has no active ride"

export interface ActiveRide {
  id: string;
  supervisorId: string;
  status: string;
}

async function loadFromDb(driverId: string): Promise<ActiveRide | null> {
  // queuedBehindRideId: null → the driver's CURRENT ride, not one held in the
  // queue behind it. (Previously this was an unordered findFirst that could
  // return either row.)
  return prisma.ride.findFirst({
    where: {
      driverId,
      status: { in: ['in_progress', 'assigned'] },
      queuedBehindRideId: null,
    },
    select: { id: true, supervisorId: true, status: true },
  });
}

export async function getDriverActiveRide(driverId: string): Promise<ActiveRide | null> {
  const key = `${KEY_PREFIX}${driverId}`;

  try {
    const cached = await redis.get(key);
    if (cached !== null) {
      return cached === NONE ? null : (JSON.parse(cached) as ActiveRide);
    }
  } catch (err) {
    logger.warn({ err, driverId }, 'activeRideCache read failed — falling back to DB');
  }

  const ride = await loadFromDb(driverId);

  try {
    await redis.set(key, ride ? JSON.stringify(ride) : NONE, 'EX', TTL_SECONDS);
  } catch (err) {
    logger.warn({ err, driverId }, 'activeRideCache write failed');
  }

  return ride;
}

/**
 * Called with the drivers whose rides just changed. server.ts registers one
 * that emits `driver:rides_changed` to each driver's socket, so the driver app
 * refreshes at once instead of waiting for its (now slow) poll. Injected so this
 * module stays free of Socket.IO.
 */
type DriverNotifier = (driverIds: string[]) => void;
let ridesNotifier: DriverNotifier | null = null;

export function setDriverRidesNotifier(fn: DriverNotifier | null): void {
  ridesNotifier = fn;
}

/**
 * Drop the cached entry for one or more drivers and tell their apps that their
 * rides changed. Safe to call with null/undefined. Never throws.
 */
export async function invalidateDriverActiveRide(
  ...driverIds: Array<string | null | undefined>
): Promise<void> {
  const ids = [...new Set(driverIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  const keys = ids.map((id) => `${KEY_PREFIX}${id}`);
  try {
    await redis.del(...keys);
  } catch (err) {
    logger.warn({ err, keys }, 'activeRideCache invalidate failed (TTL will expire it)');
  }
  if (ridesNotifier) {
    try {
      ridesNotifier(ids);
    } catch (err) {
      // The ride change has already committed; the app's poll reconciles.
      logger.warn({ err, driverIds: ids }, 'driver rides notifier failed');
    }
  }
}
