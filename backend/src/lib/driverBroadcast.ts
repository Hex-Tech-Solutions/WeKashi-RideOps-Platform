import type { Server as IoServer } from 'socket.io';
import { prisma } from './prisma';
import { logger } from './logger';
import { isFcmEnabled, sendRideBroadcastPush, sendRideDismissPush, type RidePushData } from './fcm';

/** Fields we read off the ride payload to build the push. The payload is the
 *  public ride model from getRidePublicPayload(); keep this tolerant. */
interface BroadcastPayloadLike {
  id?: string;
  price?: number | null;
  vehicle_type?: string | null;
  is_ac?: boolean;
  distance_km?: number | null;
  pax_count?: number | null;
  broadcast_expires_at?: string | Date | null;
  type?: string;
  pickup_address?: string;
  drop_address?: string;
}

/**
 * Deliver a broadcast to the selected drivers over TWO channels:
 *   1. Socket.IO `ride:broadcast` — instant, for drivers with the app open.
 *   2. FCM push — reaches drivers whose app is backgrounded/killed.
 *
 * The socket emit is synchronous (unchanged behaviour). The FCM push is fired
 * as a best-effort, non-blocking side-effect: it looks up the drivers' stored
 * tokens, sends a multicast, and prunes any tokens FCM reports as stale. If FCM
 * is not configured it's skipped entirely.
 */
export function emitDriverBroadcast(
  io: IoServer,
  driverIds: string[],
  payload: unknown,
): void {
  for (const driverId of driverIds) {
    io.of('/driver').to(`driver:${driverId}`).emit('ride:broadcast', payload);
  }

  // Fire-and-forget FCM push. Never block or throw into the caller's flow.
  if (isFcmEnabled() && driverIds.length > 0) {
    void pushToDrivers(driverIds, payload as BroadcastPayloadLike).catch((err) =>
      logger.error({ err }, 'FCM broadcast push failed'),
    );
  }
}

async function pushToDrivers(driverIds: string[], payload: BroadcastPayloadLike): Promise<void> {
  const rideId = payload?.id;
  if (!rideId) return;

  const drivers = await prisma.driver.findMany({
    where: { id: { in: driverIds }, fcmToken: { not: null } },
    select: { id: true, fcmToken: true },
  });
  const tokens = drivers.map((d) => d.fcmToken!).filter(Boolean);
  if (tokens.length === 0) return;

  const data: RidePushData = {
    rideId,
    type: payload?.type ?? 'login',
    pickupAddress: payload?.pickup_address,
    dropAddress: payload?.drop_address,
    fare: payload?.price ?? null,
    vehicleType: payload?.vehicle_type ?? null,
    isAc: payload?.is_ac ?? false,
    distanceKm: payload?.distance_km ?? null,
    paxCount: payload?.pax_count ?? null,
    expiresAt: payload?.broadcast_expires_at
      ? new Date(payload.broadcast_expires_at).toISOString()
      : null,
  };

  const { staleTokens } = await sendRideBroadcastPush(tokens, data);

  // A token FCM reports as unregistered/invalid means the app was uninstalled
  // (or its data cleared) — the driver is genuinely unreachable. Under Model 2
  // this is the ONE signal that auto-flips a driver offline: clear the dead
  // token AND set is_online = false, so an uninstalled driver stops being
  // offered rides. (A token is unique per install, so match by value.)
  if (staleTokens.length > 0) {
    await prisma.driver.updateMany({
      where: { fcmToken: { in: staleTokens } },
      data: { fcmToken: null, isOnline: false },
    });
    logger.info({ count: staleTokens.length }, 'Cleared stale FCM tokens and set those drivers offline (uninstall)');
  }
}

/**
 * Dismiss the incoming-ride alert on all drivers who were offered this ride,
 * for a ride that is no longer available (cancelled / expired / taken). Looks
 * up the offered drivers' FCM tokens and sends a silent dismiss push. Also
 * emits a socket `ride:dismiss` so an app that's open clears the card instantly.
 * Best-effort and never throws into the caller.
 */
export async function dismissRideForOfferedDrivers(io: IoServer | undefined, rideId: string): Promise<void> {
  try {
    const offers = await prisma.rideOffer.findMany({
      where: { rideId },
      select: { driverId: true },
    });
    const driverIds = offers.map((o) => o.driverId);
    if (driverIds.length === 0) return;

    // Socket: tell any open driver app to drop the card immediately.
    if (io) {
      for (const driverId of driverIds) {
        io.of('/driver').to(`driver:${driverId}`).emit('ride:dismiss', { rideId });
      }
    }

    // FCM: dismiss the notification on backgrounded/killed devices.
    if (isFcmEnabled()) {
      const drivers = await prisma.driver.findMany({
        where: { id: { in: driverIds }, fcmToken: { not: null } },
        select: { fcmToken: true },
      });
      const tokens = drivers.map((d) => d.fcmToken!).filter(Boolean);
      if (tokens.length > 0) await sendRideDismissPush(tokens, rideId);
    }
  } catch (err) {
    logger.error({ err, rideId }, 'dismissRideForOfferedDrivers failed');
  }
}
