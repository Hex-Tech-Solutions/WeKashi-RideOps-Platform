// Shared next-ride-queueing promotion helper, in lib/ to avoid a circular
// import between ride.service.ts and ridePax.service.ts (both need to promote a
// queued ride when an active ride terminates).

import { Prisma } from '@prisma/client';
import { logger } from './logger';

/**
 * Promote a driver's queued ride to active once the ride it was waiting behind
 * (terminatedRideId) ends — by completion, cancellation, expiry, or driver
 * drop. Runs inside the caller's transaction. Idempotent: guarded by the
 * queued_behind_ride_id match + FOR UPDATE, so a second call finds nothing.
 * Returns the promoted ride id (or null if the driver had no queued ride).
 */
export async function promoteQueuedRide(
  tx: Prisma.TransactionClient,
  terminatedRideId: string,
  driverId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM rides
    WHERE driver_id = ${driverId}
      AND queued_behind_ride_id = ${terminatedRideId}
      AND status = 'assigned'
    LIMIT 1 FOR UPDATE
  `;
  if (rows.length === 0) return null;
  const promotedId = rows[0].id;
  await tx.$executeRaw`
    UPDATE rides SET queued_behind_ride_id = NULL WHERE id = ${promotedId}
  `;
  logger.info({ terminatedRideId, promotedRideId: promotedId, driverId }, 'Promoted queued ride to active');
  return promotedId;
}
