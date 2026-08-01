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

// ─── Flush all buffered positions to DB ──────────────────────────────────────

export async function flushLocationBuffer(): Promise<void> {
  const start = Date.now();

  try {
    // ── 1. Find all buffered driver positions ──────────────────────────────
    const posKeys = await redis.keys(`${DRIVER_POS_PREFIX}*`);
    if (posKeys.length === 0) return;

    const posValues = await redis.mget(...posKeys);

    type PosEntry = { driverId: string; lat: number; lng: number };
    const positions: PosEntry[] = [];

    for (let i = 0; i < posKeys.length; i++) {
      const raw = posValues[i];
      if (!raw) continue;
      try {
        const { lat, lng } = JSON.parse(raw) as { lat: number; lng: number };
        const driverId = posKeys[i].slice(DRIVER_POS_PREFIX.length);
        // Double-check coordinates from Redis are finite and in valid range
        if (Number.isFinite(lat) && Number.isFinite(lng) &&
            lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          positions.push({ driverId, lat, lng });
        }
      } catch {
        // malformed entry — skip
      }
    }

    // ── 2. Bulk-update driver current_location (one raw query) ────────────
    if (positions.length > 0) {
      // Validate all driverIds are UUIDs before building dynamic SQL
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const safePositions = positions.filter((p) => UUID_RE.test(p.driverId));

      if (safePositions.length > 0) {
        const cases = safePositions
          .map((p) => `WHEN id = '${p.driverId}' THEN ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`)
          .join(' ');
        const ids = safePositions.map((p) => `'${p.driverId}'`).join(',');

        await prisma.$executeRawUnsafe(`
          UPDATE drivers
          SET current_location = CASE ${cases} ELSE current_location END,
              is_online = true
          WHERE id IN (${ids})
        `);
      }
    }

    // ── 3. Flush ride breadcrumb trails ───────────────────────────────────
    const trailKeys = await redis.keys(`${RIDE_TRAIL_PREFIX}*`);
    if (trailKeys.length > 0) {
      const breadcrumbs: Array<{ rideId: string; driverId: string; lat: number; lng: number; recordedAt: Date }> = [];

      for (const key of trailKeys) {
        // Key format: trail:<rideId>:<driverId>
        const parts = key.slice(RIDE_TRAIL_PREFIX.length).split(':');
        if (parts.length < 2) continue;
        const rideId   = parts[0];
        const driverId = parts[1];

        const entries = await redis.lrange(key, 0, -1);
        await redis.del(key); // clear after reading

        for (const entry of entries) {
          try {
            const { lat, lng, ts } = JSON.parse(entry) as { lat: number; lng: number; ts: number };
            breadcrumbs.push({ rideId, driverId, lat, lng, recordedAt: new Date(ts) });
          } catch {
            // skip malformed
          }
        }
      }

      if (breadcrumbs.length > 0) {
        await prisma.rideLocationLog.createMany({
          data: breadcrumbs,
          skipDuplicates: true,
        });
      }
    }

    const elapsed = Date.now() - start;
    logger.debug(
      { drivers: positions.length, trails: trailKeys.length, elapsed },
      'Location buffer flushed',
    );
  } catch (err) {
    logger.error({ err }, 'Location buffer flush error');
    // Don't throw — next flush will pick up any missed data still in Redis
  }
}

// ─── Start / stop the flush timer ─────────────────────────────────────────────

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
