import { prisma } from './prisma';
import { redis } from './redis';
import { logger } from './logger';
import type { Server as IoServer } from 'socket.io';

let sweeperInterval: NodeJS.Timeout | null = null;
let ioInstance: IoServer | null = null;

export function initBroadcastSweeper(io: IoServer): void {
  ioInstance = io;

  if (sweeperInterval) {
    clearInterval(sweeperInterval);
  }

  sweeperInterval = setInterval(async () => {
    await sweepExpiredBroadcasts();
  }, 30_000);

  logger.info('Broadcast sweeper started (interval: 30s)');
}

export function stopBroadcastSweeper(): void {
  if (sweeperInterval) {
    clearInterval(sweeperInterval);
    sweeperInterval = null;
    logger.info('Broadcast sweeper stopped');
  }
}

async function sweepExpiredBroadcasts(): Promise<void> {
  try {
    const expiredRides = await prisma.$queryRaw<Array<{ id: string; supervisor_id: string }>>`
      SELECT id, supervisor_id
      FROM rides
      WHERE status = 'broadcasting'
        AND broadcast_expires_at < NOW()
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

/**
 * Start a broadcast for a ride: set Redis TTL key and expiry in DB.
 */
export async function startRideBroadcast(rideId: string): Promise<void> {
  await redis.set(`ride:broadcast:${rideId}`, '1', 'EX', 180);
}
