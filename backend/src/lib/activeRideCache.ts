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

/** Drop the cached entry for one or more drivers. Safe to call with null/undefined. */
export async function invalidateDriverActiveRide(
  ...driverIds: Array<string | null | undefined>
): Promise<void> {
  const keys = driverIds.filter((id): id is string => !!id).map((id) => `${KEY_PREFIX}${id}`);
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    logger.warn({ err, keys }, 'activeRideCache invalidate failed (TTL will expire it)');
  }
}
