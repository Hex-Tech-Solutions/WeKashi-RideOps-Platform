import { prisma } from './prisma';
import { redis } from './redis';
import { logger } from './logger';
import type { Server as IoServer } from 'socket.io';

// Lazy import to avoid circular dependency (ride.service.ts doesn't import broadcastSweeper directly at module scope)
async function sweepStaleScheduledRides(): Promise<void> {
  const { sweepStaleScheduledRides: sweep } = await import('../services/ride.service');
  await sweep(ioInstance ?? undefined);
}

// Expire rentals never accepted by their scheduled pickup time. The supervisor's
// rental list polls every 15s, so the 'expired' status surfaces there on its own
// — no socket push needed. Lazy import for the circular-dependency reason.
async function sweepStaleRentals(): Promise<void> {
  const { expireStaleRentals } = await import('../services/rental.service');
  await expireStaleRentals();
}

let sweeperInterval: NodeJS.Timeout | null = null;
let ioInstance: IoServer | null = null;

let sweeperStopped = false;

export function initBroadcastSweeper(io: IoServer): void {
  ioInstance = io;
  sweeperStopped = false;

  if (sweeperInterval) {
    clearTimeout(sweeperInterval);
    sweeperInterval = null;
  }

  // Self-scheduling loop instead of setInterval: a sweep that runs longer than
  // the 30s tick can no longer overlap itself (which caused duplicate promotion
  // work), and a rejected promise can't escape as an unhandled rejection — the
  // whole body is awaited inside one try/catch and the NEXT run is only
  // scheduled after this one settles.
  const tick = async (): Promise<void> => {
    try {
      await sweepExpiredBroadcasts();
      await sweepStaleScheduledRides();
      await sweepStaleRentals();
      await sweepGhostOnlineDrivers();
    } catch (err) {
      logger.error({ err }, 'Broadcast sweeper tick failed');
    } finally {
      if (!sweeperStopped) {
        sweeperInterval = setTimeout(() => { void tick(); }, 30_000);
      }
    }
  };

  // Kick off the first run after one interval (preserves prior timing).
  sweeperInterval = setTimeout(() => { void tick(); }, 30_000);

  logger.info('Broadcast sweeper started (interval: 30s, non-overlapping)');
}

export function stopBroadcastSweeper(): void {
  sweeperStopped = true;
  if (sweeperInterval) {
    clearTimeout(sweeperInterval);
    sweeperInterval = null;
    logger.info('Broadcast sweeper stopped');
  }
}

async function sweepExpiredBroadcasts(): Promise<void> {
  try {
    // Catch both normally-expired broadcasts AND any stuck 'broadcasting' row
    // that somehow has no expiry set (otherwise NULL < NOW() is never true and
    // the row would broadcast forever).
    const expiredRides = await prisma.$queryRaw<Array<{ id: string; supervisor_id: string }>>`
      SELECT id, supervisor_id
      FROM rides
      WHERE status = 'broadcasting'
        AND (broadcast_expires_at IS NULL OR broadcast_expires_at < NOW())
    `;

    if (expiredRides.length === 0) return;

    logger.info({ count: expiredRides.length }, 'Sweeping expired broadcast rides');

    for (const ride of expiredRides) {
      try {
        await prisma.$executeRaw`
          UPDATE rides
          SET status = 'expired'
          WHERE id = ${ride.id}
            AND status = 'broadcasting'
        `;

        // Clean up Redis key
        await redis.del(`ride:broadcast:${ride.id}`);

        // Emit socket event
        if (ioInstance) {
          ioInstance
            .of('/supervisor')
            .to(`supervisor:${ride.supervisor_id}`)
            .emit('ride:expired', { rideId: ride.id });

          ioInstance.of('/admin').to('admin').emit('admin:activity', {
            event: 'ride:expired',
            rideId: ride.id,
          });
        }
      } catch (err) {
        logger.error({ err, rideId: ride.id }, 'Error expiring ride in sweeper');
      }
    }
  } catch (err) {
    logger.error({ err }, 'Broadcast sweeper error');
  }
}

// How long a driver can go without a GPS heartbeat before we treat them as gone.
// Online drivers flush their location every 60s (and ping every ~10s), so 3 min
// of silence reliably means the app was swiped/crashed/lost signal/died — not a
// brief tunnel. Keep this comfortably above the 60s flush interval.
const GHOST_ONLINE_STALE_MINUTES = 3;

/**
 * Flip "ghost-online" drivers offline — drivers whose app died without a clean
 * go-offline (swipe-kill, crash, battery, dead signal), so their is_online flag
 * is stuck true while they send no GPS. Left alone they pollute matching, the
 * nearby-driver search, rental eligibility and the admin live map with a driver
 * who can never respond. The go-online path and the 60s location flush both
 * stamp location_updated_at, so a genuinely active driver is never swept.
 */
async function sweepGhostOnlineDrivers(): Promise<void> {
  try {
    // NULL location_updated_at while online shouldn't happen (go-online seeds it),
    // but treat it as stale too so a legacy/odd row can't linger forever.
    const stale = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
      UPDATE drivers
      SET is_online = false
      WHERE is_online = true
        AND (location_updated_at IS NULL
             OR location_updated_at < NOW() - INTERVAL '${GHOST_ONLINE_STALE_MINUTES} minutes')
      RETURNING id
    `);

    if (stale.length === 0) return;

    logger.info({ count: stale.length }, 'Swept ghost-online drivers (stale GPS heartbeat)');

    // Tell the admin live map to drop them promptly rather than waiting for its
    // next poll. Supervisor/driver views derive availability from is_online, so
    // the flip alone fixes matching; this is just the map-freshness nudge.
    if (ioInstance) {
      for (const d of stale) {
        ioInstance.of('/admin').to('admin').emit('admin:activity', {
          event: 'driver:offline_stale',
          driverId: d.id,
        });
      }
    }
  } catch (err) {
    logger.error({ err }, 'Ghost-online driver sweep failed');
  }
}

/**
 * Start a broadcast for a ride: set Redis TTL key and expiry in DB.
 */
export async function startRideBroadcast(rideId: string): Promise<void> {
  // Broadcast auction window is 1 minute (matches broadcast_expires_at INTERVAL
  // '1 minute' on the ride row). Keep these two in sync.
  await redis.set(`ride:broadcast:${rideId}`, '1', 'EX', 60);
}
