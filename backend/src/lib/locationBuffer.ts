/**
 * Location buffer — reduces DB writes from ~1,200/sec to ~2/min.
 *
 * Every GPS ping:
 *   1. Updates Redis immediately (latest position, TTL 5 min)
 *   2. Buffers the position for the active ride's breadcrumb trail
 *   3. Socket.io emit happens in the calling code — NOT deferred
 *
 * Every 60 seconds (flush interval):
 *   1. Reads all buffered positions from Redis
 *   2. Bulk-updates drivers.current_location (one query)
 *   3. Bulk-inserts ride_location_logs for in_progress rides (one query)
 *   4. Clears the buffer
 *
 * This means:
 *   - Live map / supervisor tracking: real-time (Socket.io, unchanged)
 *   - DB current_location: max 60s stale (fine for nearby-driver queries)
 *   - GPS trail for completed rides: up to 60s gaps between breadcrumbs
 */

import { redis } from './redis';
import { prisma } from './prisma';
import { logger } from './logger';

const DRIVER_POS_PREFIX = 'dpos:';       // latest position per driver
const RIDE_TRAIL_PREFIX = 'trail:';      // pending breadcrumbs per ride
const FLUSH_INTERVAL_MS = 60_000;        // 60 seconds

let flushTimer: ReturnType<typeof setInterval> | null = null;

// ─── Buffer a driver's position in Redis ──────────────────────────────────────

export async function bufferDriverLocation(
  driverId: string,
  lat: number,
  lng: number,
  activeRideId: string | null,
  isInProgress: boolean,
): Promise<void> {
  // Guard: reject non-finite coordinates (would break the SQL bulk-update)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    logger.warn({ driverId, lat, lng }, 'Invalid GPS coordinates — skipping buffer');
    return;
  }

  const pipeline = redis.pipeline();

  // 1. Store latest driver position (expires after 5 min of inactivity)
  pipeline.setex(
    `${DRIVER_POS_PREFIX}${driverId}`,
    300,
    JSON.stringify({ lat, lng, ts: Date.now() }),
  );

  // 2. Buffer breadcrumb for in_progress rides
  if (activeRideId && isInProgress) {
    pipeline.rpush(
      `${RIDE_TRAIL_PREFIX}${activeRideId}:${driverId}`,
      JSON.stringify({ lat, lng, ts: Date.now() }),
    );
    // Keep trail buffer max 2 hours (safety TTL)
    pipeline.expire(`${RIDE_TRAIL_PREFIX}${activeRideId}:${driverId}`, 7200);
  }

  await pipeline.exec();
}

// --- Flush all buffered positions to DB ------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHUNK = 300;
let flushing = false;

/** Non-blocking key listing (SCAN) - KEYS would block Redis for every client. */
async function scanKeys(pattern: string): Promise<string[]> {
  const out: string[] = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    out.push(...keys);
  } while (cursor !== '0');
  return out;
}

export async function flushLocationBuffer(): Promise<void> {
  if (flushing) return; // never overlap two flushes
  flushing = true;
  const start = Date.now();

  try {
    // 1. Driver positions
    const posKeys = await scanKeys(`${DRIVER_POS_PREFIX}*`);
    const positions: Array<{ driverId: string; lat: number; lng: number }> = [];

    for (let i = 0; i < posKeys.length; i += 500) {
      const keys = posKeys.slice(i, i + 500);
      const vals = await redis.mget(...keys);
      for (let j = 0; j < keys.length; j++) {
        const raw = vals[j];
        if (!raw) continue;
        try {
          const { lat, lng } = JSON.parse(raw) as { lat: number; lng: number };
          const driverId = keys[j].slice(DRIVER_POS_PREFIX.length);
          if (UUID_RE.test(driverId) && Number.isFinite(lat) && Number.isFinite(lng) &&
              lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            positions.push({ driverId, lat, lng });
          }
        } catch { /* malformed - skip */ }
      }
    }

    // Parameterised bulk update in chunks, so no single statement locks
    // thousands of driver rows or builds a giant SQL string.
    for (let i = 0; i < positions.length; i += CHUNK) {
      const chunk = positions.slice(i, i + CHUNK);
      await prisma.$executeRaw`
        UPDATE drivers d
        SET current_location = ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326)::geography,
            is_online = true,
            location_updated_at = NOW()
        FROM (
          -- drivers.id is TEXT (Prisma String), so compare as text, not uuid.
          SELECT unnest(${chunk.map((p) => p.driverId)}::text[]) AS id,
                 unnest(${chunk.map((p) => p.lng)}::float8[]) AS lng,
                 unnest(${chunk.map((p) => p.lat)}::float8[]) AS lat
        ) v
        WHERE d.id = v.id
      `;
    }

    // 2. Ride breadcrumb trails
    const trailKeys = await scanKeys(`${RIDE_TRAIL_PREFIX}*`);
    const breadcrumbs: Array<{ rideId: string; driverId: string; lat: number; lng: number; recordedAt: Date }> = [];

    for (const key of trailKeys) {
      const parts = key.slice(RIDE_TRAIL_PREFIX.length).split(':');
      if (parts.length < 2) continue;
      const [rideId, driverId] = parts;

      // Atomic read+clear: a ping landing between lrange and del can't be lost.
      const res = await redis.multi().lrange(key, 0, -1).del(key).exec();
      const entries = (res?.[0]?.[1] as string[] | undefined) ?? [];

      for (const entry of entries) {
        try {
          const { lat, lng, ts } = JSON.parse(entry) as { lat: number; lng: number; ts: number };
          breadcrumbs.push({ rideId, driverId, lat, lng, recordedAt: new Date(ts) });
        } catch { /* skip malformed */ }
      }
    }

    for (let i = 0; i < breadcrumbs.length; i += 1000) {
      await prisma.rideLocationLog.createMany({
        data: breadcrumbs.slice(i, i + 1000),
        skipDuplicates: true,
      });
    }

    logger.debug(
      { drivers: positions.length, trails: trailKeys.length, elapsed: Date.now() - start },
      'Location buffer flushed',
    );
  } catch (err) {
    logger.error({ err }, 'Location buffer flush error');
  } finally {
    flushing = false;
  }
}

// --- Start / stop the flush timer ---------------------------------------------

export function startLocationFlusher(): void {
  if (flushTimer) return;
  flushTimer = setInterval(flushLocationBuffer, FLUSH_INTERVAL_MS);
  flushTimer.unref(); // don't keep process alive if everything else exits
  logger.info({ intervalMs: FLUSH_INTERVAL_MS }, 'Location buffer flusher started');
}

export function stopLocationFlusher(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
