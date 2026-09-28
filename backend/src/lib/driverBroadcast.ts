import type { Server as IoServer } from 'socket.io';

/** Deliver a broadcast only to drivers selected by the server eligibility query. */
export function emitDriverBroadcast(
  io: IoServer,
  driverIds: string[],
  payload: unknown,
): void {
  for (const driverId of driverIds) {
    io.of('/driver').to(`driver:${driverId}`).emit('ride:broadcast', payload);
  }
}
