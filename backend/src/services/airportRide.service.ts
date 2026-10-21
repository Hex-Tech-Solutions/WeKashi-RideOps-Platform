// Airport_Ride_Service — a supervisor books a single-passenger airport transfer
// (to or from a fixed BLR terminal). It reuses the `rides` table (type =
// 'airport') and all the normal-ride broadcast/accept/credit/payment machinery,
// but has NO employee link and NO ride_pax rows: the passenger is entered
// manually and the pickup/drop OTPs live on the ride itself, relayed verbally by
// the supervisor (the escort-OTP pattern). Fare is per-km (no bands/minimum) +
// an estimated road toll — AC is always included and never charged.

import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { redis } from '../lib/redis';
import { randomInt } from 'crypto';
import type { Server as IoServer } from 'socket.io';
import { NotFoundError, ValidationError, ForbiddenError } from '../types';
import { logger } from '../lib/logger';
import { airportFare, type VehicleType } from '../lib/pricing';
import {
  terminalPoint, terminalLabel, type AirportTerminal, type AirportDirection,
} from '../lib/airport';
import { findNearbyDrivers } from './driver.service';
import { startRideBroadcast } from '../lib/broadcastSweeper';
import { emitDriverBroadcast } from '../lib/driverBroadcast';
import { getRidePublicPayload } from './ride.service';
import { consumeOneCredit } from './creditPack.service';
import { promoteQueuedRide } from '../lib/ridePromotion';

const gen4 = () => String(randomInt(1000, 10000));
const BROADCAST_RADIUS_KM = 10;
const TOLL_MAX = 5000;

export interface CreateAirportRideInput {
  supervisorId: string;
  direction: AirportDirection;       // to_airport | from_airport
  terminal: AirportTerminal;         // T1 | T2
  /** The dynamic (non-terminal) end: pickup for to_airport, drop for from_airport. */
  cityPoint: { lat: number; lng: number };
  cityAddress: string;
  paxName: string;
  paxPhone: string;
  flightNumber?: string | null;
  vehicleType: VehicleType;
  distanceKm: number;
  tollCharge?: number;               // echoed from route preview; clamped here
  scheduledFor?: Date;               // set → goes to the scheduled marketplace
}

function clampToll(v: number | undefined): number {
  return Number.isFinite(v) ? Math.min(TOLL_MAX, Math.max(0, Math.round(v as number))) : 0;
}

/**
 * Resolve the ride-level pickup/drop points + addresses from the direction.
 * to_airport:   pickup = city (dynamic),  drop = terminal (fixed)
 * from_airport: pickup = terminal (fixed), drop = city (dynamic)
 */
function resolveEndpoints(input: CreateAirportRideInput) {
  const term = terminalPoint(input.terminal);
  const termLabel = `${terminalLabel(input.terminal)}, Kempegowda Intl Airport (BLR)`;
  if (input.direction === 'to_airport') {
    return {
      pickup: input.cityPoint, pickupAddress: input.cityAddress,
      drop: term, dropAddress: termLabel,
    };
  }
  return {
    pickup: term, pickupAddress: termLabel,
    drop: input.cityPoint, dropAddress: input.cityAddress,
  };
}

export async function createAirportRide(
  input: CreateAirportRideInput,
  io?: IoServer,
): Promise<{ ride: { id: string; status: string }; nearbyCount: number }> {
  if (!input.paxName.trim()) throw new ValidationError('Passenger name is required');
  if (!input.paxPhone.trim()) throw new ValidationError('Passenger mobile number is required');
  if (!(input.distanceKm > 0)) throw new ValidationError('Route distance is required');

  const fare = airportFare(input.distanceKm, input.vehicleType);
  const toll = clampToll(input.tollCharge);
  const totalAmount = fare + toll;

  const pickupOtp = gen4();
  const dropOtp = gen4();
  const { pickup, pickupAddress, drop, dropAddress } = resolveEndpoints(input);

  // Scheduled → marketplace (status 'scheduled'); else broadcast now.
  const scheduled = !!input.scheduledFor;
  if (scheduled) {
    if (input.scheduledFor!.getTime() < Date.now()) {
      throw new ValidationError('Scheduled time must be in the future');
    }
  }

  // Broadcast window only applies to immediate (non-scheduled) rides. Kept in
  // sync with the 60s Redis key startRideBroadcast sets.
  const broadcastStarted = scheduled ? Prisma.sql`NULL` : Prisma.sql`NOW()`;
  const broadcastExpires = scheduled ? Prisma.sql`NULL` : Prisma.sql`NOW() + INTERVAL '1 minute'`;
  const statusLiteral = scheduled ? 'scheduled' : 'broadcasting';

  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO rides (
      id, type, status, supervisor_id,
      pickup_point, drop_point, pickup_address, drop_address,
      distance_km, price, toll_charge, total_amount, vehicle_type, is_ac,
      pax_count, capacity, scheduled_for,
      airport_direction, airport_terminal, pax_name, pax_phone, flight_number,
      airport_pickup_otp, airport_drop_otp,
      broadcast_started_at, broadcast_expires_at, created_at
    ) VALUES (
      gen_random_uuid(),
      'airport'::"RideType",
      ${statusLiteral}::"RideStatus",
      ${input.supervisorId},
      ST_SetSRID(ST_MakePoint(${pickup.lng}, ${pickup.lat}), 4326)::geography,
      ST_SetSRID(ST_MakePoint(${drop.lng}, ${drop.lat}), 4326)::geography,
      ${pickupAddress},
      ${dropAddress},
      ${input.distanceKm},
      ${fare},
      ${toll > 0 ? toll : null},
      ${totalAmount},
      ${input.vehicleType},
      false,
      1,
      1,
      ${input.scheduledFor ?? null},
      ${input.direction},
      ${input.terminal},
      ${input.paxName.trim()},
      ${input.paxPhone.trim()},
      ${input.flightNumber?.trim() || null},
      ${pickupOtp},
      ${dropOtp},
      ${broadcastStarted},
      ${broadcastExpires},
      NOW()
    )
    RETURNING id
  `;
  const rideId = rows[0].id;

  if (scheduled) {
    logger.info({ rideId, supervisorId: input.supervisorId }, 'Airport ride scheduled');
    return { ride: { id: rideId, status: 'scheduled' }, nearbyCount: 0 };
  }

  await startRideBroadcast(rideId);

  const nearby = await findNearbyDrivers(pickup.lat, pickup.lng, BROADCAST_RADIUS_KM, input.vehicleType);
  const driverIds = nearby.map((d) => d.id);
  if (driverIds.length > 0) {
    await prisma.rideOffer.createMany({
      data: driverIds.map((driverId) => ({ rideId, driverId, response: 'pending' as const })),
      skipDuplicates: true,
    });
  }

  logger.info({ rideId, nearbyCount: driverIds.length }, 'Airport ride created, broadcasting');

  if (io && driverIds.length > 0) {
    const payload = await getRidePublicPayload(rideId);
    emitDriverBroadcast(io, driverIds, payload);
    io.of('/supervisor')
      .to(`supervisor:${input.supervisorId}`)
      .emit('ride:status_changed', { rideId, status: 'broadcasting', nearbyCount: driverIds.length });
  }

  return { ride: { id: rideId, status: 'broadcasting' }, nearbyCount: driverIds.length };
}

// ── OTP verification (supervisor-relayed) ─────────────────────────────────────

async function assertAirportDriverRide(rideId: string, driverId: string) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new NotFoundError('Ride not found');
  if (ride.type !== 'airport') throw new ValidationError('Not an airport ride');
  if (ride.driverId !== driverId) throw new ForbiddenError('Not your ride');
  return ride;
}

async function checkOtpRateLimit(rideId: string, which: 'pickup' | 'drop') {
  const key = `airport:otp:${which}:${rideId}`;
  const attempts = await redis.incr(key);
  if (attempts === 1) await redis.expire(key, 3600);
  if (attempts > 5) throw new ValidationError('Too many OTP attempts. Try again later.');
}

/** Driver verifies the pickup OTP → ride goes in_progress. */
export async function verifyAirportPickup(rideId: string, otp: string, driverId: string) {
  const ride = await assertAirportDriverRide(rideId, driverId);
  if (ride.status !== 'assigned') throw new ValidationError('This ride is not ready to start');
  if (ride.airportPickupAt) throw new ValidationError('Pickup already verified');
  await checkOtpRateLimit(rideId, 'pickup');
  if (ride.airportPickupOtp !== otp) throw new ValidationError('Incorrect pickup OTP');
  await redis.del(`airport:otp:pickup:${rideId}`);
  await prisma.ride.update({
    where: { id: rideId },
    data: { status: 'in_progress', startedAt: new Date(), airportPickupAt: new Date() },
  });
  logger.info({ rideId, driverId }, 'Airport ride started (pickup OTP verified)');
  return { ok: true };
}

/**
 * Driver verifies the drop OTP → ride completes. Burns one ride credit and
 * promotes any queued ride, exactly like a normal completion.
 */
export async function verifyAirportDrop(rideId: string, otp: string, driverId: string) {
  const ride = await assertAirportDriverRide(rideId, driverId);
  if (ride.status !== 'in_progress') throw new ValidationError('Start the ride (pickup OTP) first');
  if (ride.airportDropAt) throw new ValidationError('Drop already verified');
  await checkOtpRateLimit(rideId, 'drop');
  if (ride.airportDropOtp !== otp) throw new ValidationError('Incorrect drop OTP');
  await redis.del(`airport:otp:drop:${rideId}`);

  const promotedRideId = await prisma.$transaction(async (tx) => {
    await tx.ride.update({
      where: { id: rideId },
      data: { status: 'completed', completedAt: new Date(), airportDropAt: new Date() },
    });
    await consumeOneCredit(tx, driverId, rideId);
    return promoteQueuedRide(tx, rideId, driverId);
  });
  logger.info({ rideId, driverId }, 'Airport ride completed (drop OTP verified)');
  return { ok: true, promotedRideId };
}
