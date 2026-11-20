import { redis } from './redis';
import { logger } from './logger';

/**
 * 10-second Redis cache of the scheduled-rides marketplace, per vehicle type.
 *
 * Every online driver with the same vehicle type gets the same list, so
 * building it from Postgres for each poll was wasted work (load test, Nov
 * 2026). Live broadcast offers are NOT cached; they stay per-driver and
 * instant.
 *
 * - Fails open: any Redis error falls back to building the list from Postgres.
 * - Every path that moves a ride into or out of 'scheduled' calls
 *   invalidateScheduledCache(); the TTL bounds staleness for anything missed.
 * - The prefix must never be `dpos:` or `trail:` (the location flusher SCANs
 *   those) or `activeride:`.
 */
export const SCHEDULED_CACHE_PREFIX = 'cache:scheduled:';
export const SCHEDULED_CACHE_TTL_SEC = 10;

export function scheduledCacheKey(vehicleType?: string | null): string {
  return `${SCHEDULED_CACHE_PREFIX}${vehicleType ? vehicleType : 'any'}`;
}

/**
 * Return the cached list for this vehicle type, or build, cache and return it.
 * Hit and miss both return the JSON round-trip of the list, which is exactly
 * the body the route sends, so callers see identical data either way.
 */
export async function cachedScheduledList<T>(
  vehicleType: string | null | undefined,
  build: () => Promise<T>,
): Promise<T> {
  const key = scheduledCacheKey(vehicleType);
  try {
    const hit = await redis.get(key);
    if (hit !== null) return JSON.parse(hit) as T;
  } catch (err) {
    logger.warn({ err, key }, 'scheduledCache read failed, building from DB');
  }

  const json = JSON.stringify(await build());
  try {
    await redis.set(key, json, 'EX', SCHEDULED_CACHE_TTL_SEC);
  } catch (err) {
    logger.warn({ err, key }, 'scheduledCache write failed');
  }
  return JSON.parse(json) as T;
}

/** Drop every cached scheduled list. Never throws. */
export async function invalidateScheduledCache(): Promise<void> {
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${SCHEDULED_CACHE_PREFIX}*`, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } catch (err) {
    logger.warn({ err }, 'scheduledCache invalidate failed (TTL will expire it)');
  }
}