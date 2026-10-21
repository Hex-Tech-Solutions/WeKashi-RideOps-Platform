import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';

// A blocked driver's short-lived access token (<=15 min) must stop working at
// once. We set a Redis flag that authenticate() checks for drivers; its TTL
// matches the max access-token lifetime, after which no valid access token for
// that driver can exist anyway, so the flag self-expires. Keep this >= the
// JWT_ACCESS_EXPIRY ceiling.
const BLOCK_TTL_SEC = 20 * 60; // 20 min (access tokens live 15 min)
const blockKey = (driverId: string) => `driver:blocked:${driverId}`;

/** Immediately cut off a driver: revoke refresh tokens + flag the block. */
export async function revokeDriverAccess(driverId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { driverId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  try {
    await redis.set(blockKey(driverId), '1', 'EX', BLOCK_TTL_SEC);
  } catch (err) {
    // Redis down → refresh-token revocation still caps exposure to <=15 min.
    logger.warn({ err, driverId }, 'Could not set driver block flag in Redis');
  }
  logger.info({ driverId }, 'Driver access revoked (blacklisted/expired)');
}

/** Lift the block when a driver is re-activated. */
export async function clearDriverBlock(driverId: string): Promise<void> {
  try {
    await redis.del(blockKey(driverId));
  } catch {
    /* best-effort */
  }
}

/** True if the driver is currently blocked. Cheap single Redis GET. */
export async function isDriverBlocked(driverId: string): Promise<boolean> {
  try {
    return (await redis.exists(blockKey(driverId))) === 1;
  } catch {
    // Fail OPEN on a Redis outage: refresh-token revocation already bounds the
    // exposure window, and failing closed here would lock out every driver if
    // Redis blips. The block is a fast-path, not the only guarantee.
    return false;
  }
}
