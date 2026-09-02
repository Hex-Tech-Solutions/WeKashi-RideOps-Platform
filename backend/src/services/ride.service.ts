import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { startRideBroadcast } from '../lib/broadcastSweeper';
import { findNearbyDrivers } from './driver.service';
import {
  ConflictError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from '../types';
import { logger } from '../lib/logger';
import {
  computeFare, type VehicleType, PLATFORM_FEE, escortCharge, FARE_ADJUSTMENT_OPTIONS,
  releaseFine, SCHEDULED_NO_SHOW_FINE, DRIVER_DROP_AFTER_ARRIVAL_FINE,
} from '../lib/pricing';
import { createRidePax, sendPaxOtpSms } from './ridePax.service';
import { randomInt } from 'crypto';
import type { Server as IoServer } from 'socket.io';

// Same 4-digit OTP format as employee pickup/drop OTPs (ridePax.service.ts).
const genEscortOtp = () => String(randomInt(1000, 10000));

export interface CreateRideInput {
  type: 'login' | 'logout' | 'scheduled';
  supervisorId: string;
  pickupPoint: { lat: number; lng: number };
  dropPoint: { lat: number; lng: number };
  pickupAddress: string;
  dropAddress: string;
  employeeIds: string[];
  scheduledFor?: Date;
  capacity?: number;
  vendorId?: string;
  distanceKm?: number;
  vehicleType?: VehicleType;
  isAc?: boolean;
  /** Manual fare top-up the supervisor adds at booking time (e.g. +50/+100), added to the computed driver fare. */
  fareAdjustment?: number;
  scheduled?: boolean;
  /** Per-employee expected pickup times — empId → HH:MM */
  scheduledPickupTimes?: Record<string, string>;
  /** Planned departure/pickup time set by supervisor — stored for OTD reporting */
  plannedStartTime?: Date;
  /** Women's safety escort */
  escortRequired?: boolean;
  escortName?: string | null;
}

const BROADCAST_RADIUS_KM = 10;

export async function createRide(
  input: CreateRideInput,
  io?: IoServer,
): Promise<{ ride: { id: string; status: string }; nearbyCount: number }> {
  // Server-authoritative fare from distance + vehicle type + AC option.
  // Manual fare adjustment (supervisor's +50/+75/+100/+125/+150 top-up) must be
  // one of the allowed options — re-validated here, never trusted from the client.
  const fareAdjustment = input.fareAdjustment && FARE_ADJUSTMENT_OPTIONS.includes(input.fareAdjustment as any)
    ? input.fareAdjustment
    : 0;
  const price = input.distanceKm != null
    ? computeFare(input.distanceKm, input.vehicleType, input.isAc) + fareAdjustment
    : null;
  const escort = input.escortRequired && price != null ? escortCharge(price) : 0;

  // Fetch supervisor's pending cancellation fee to roll into this booking
  const supervisor = await prisma.user.findUnique({
    where: { id: input.supervisorId },
    select: { pendingCancellationFee: true },
  });
  const pendingCancellationFee = supervisor?.pendingCancellationFee ?? 0;
  const totalAmount = price != null ? price + PLATFORM_FEE + escort + pendingCancellationFee : null;

  // Escort return-drop OTP — LOGOUT rides only (per product decision: login
  // escorts are out of scope for the return-drop flow). Escort boards at the
  // office with the employees (no separate pickup OTP needed), and this OTP
  // gates their verified drop back at the office once all employees are
  // dropped. Never sent to the escort automatically — supervisor relays it
  // to the driver directly (visible in the supervisor console's trip detail).
  const escortOtp = input.escortRequired && input.type === 'logout' ? genEscortOtp() : null;

  // Scheduled ride: goes to the marketplace (status 'scheduled'), not broadcast.
  if (input.scheduled) {
    if (!input.scheduledFor) throw new ValidationError('A scheduled time is required');
    if (input.scheduledFor.getTime() < Date.now()) throw new ValidationError('Scheduled time must be in the future');
    if (input.scheduledFor.getTime() > Date.now() + 2 * 24 * 60 * 60 * 1000) {
      throw new ValidationError('Scheduled rides can be at most 2 days ahead');
    }
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO rides (
        id, type, status, supervisor_id,
        pickup_point, drop_point, pickup_address, drop_address,
        distance_km, price, fare_adjustment, platform_fee, total_amount, vehicle_type,
        pax_count, capacity, scheduled_for, planned_start_time,
        escort_required, escort_name, escort_charge, escort_otp,
        created_at
      ) VALUES (
        gen_random_uuid(),
        ${input.type}::"RideType",
        'scheduled'::"RideStatus",
        ${input.supervisorId},
        ST_SetSRID(ST_MakePoint(${input.pickupPoint.lng}, ${input.pickupPoint.lat}), 4326)::geography,
        ST_SetSRID(ST_MakePoint(${input.dropPoint.lng}, ${input.dropPoint.lat}), 4326)::geography,
        ${input.pickupAddress},
        ${input.dropAddress},
        ${input.distanceKm ?? null},
        ${price},
        ${fareAdjustment},
        ${PLATFORM_FEE},
        ${totalAmount},
        ${input.vehicleType ?? null},
        ${input.employeeIds.length},
        ${input.capacity ?? input.employeeIds.length},
        ${input.scheduledFor ?? null},
        ${input.plannedStartTime ?? null},
        ${input.escortRequired ?? false},
        ${input.escortName ?? null},
        ${escort > 0 ? escort : null},
        ${escortOtp},
        NOW()
      )
      RETURNING id
    `;
    const scheduledId = rows[0].id;
    // Clear pending cancellation fee
    if (pendingCancellationFee > 0) {
      await prisma.user.update({ where: { id: input.supervisorId }, data: { pendingCancellationFee: 0 } });
    }
    if (input.employeeIds.length > 0) {
      await prisma.rideEmployee.createMany({
        data: input.employeeIds.map((employeeId) => ({ rideId: scheduledId, employeeId })),
        skipDuplicates: true,
      });
      await createRidePax(scheduledId, input.employeeIds, input.scheduledPickupTimes);
    }
    return { ride: { id: scheduledId, status: 'scheduled' }, nearbyCount: 0 };
  }

  // Create ride with geography points
  const ride = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO rides (
      id, type, status, supervisor_id, vendor_id,
      pickup_point, drop_point, pickup_address, drop_address,
      distance_km, price, fare_adjustment, platform_fee, total_amount, vehicle_type,
      pax_count, capacity, scheduled_for,
      planned_start_time,
      escort_required, escort_name, escort_charge, escort_otp,
      broadcast_started_at, broadcast_expires_at, created_at
    ) VALUES (
      gen_random_uuid(),
      ${input.type}::"RideType",
      'broadcasting'::"RideStatus",
      ${input.supervisorId},
      ${input.vendorId ?? null},
      ST_SetSRID(ST_MakePoint(${input.pickupPoint.lng}, ${input.pickupPoint.lat}), 4326)::geography,
      ST_SetSRID(ST_MakePoint(${input.dropPoint.lng}, ${input.dropPoint.lat}), 4326)::geography,
      ${input.pickupAddress},
      ${input.dropAddress},
      ${input.distanceKm ?? null},
      ${price},
      ${fareAdjustment},
      ${PLATFORM_FEE},
      ${totalAmount},
      ${input.vehicleType ?? null},
      ${input.employeeIds.length},
      ${input.capacity ?? input.employeeIds.length},
      ${input.scheduledFor ?? null},
      ${input.plannedStartTime ?? null},
      ${input.escortRequired ?? false},
      ${input.escortName ?? null},
      ${escort > 0 ? escort : null},
      ${escortOtp},
      NOW(),
      NOW() + INTERVAL '3 minutes',
      NOW()
    )
    RETURNING id
  `;

  const rideId = ride[0].id;

  // Link employees + create per-passenger legs (with OTPs)
  if (input.employeeIds.length > 0) {
    await prisma.rideEmployee.createMany({
      data: input.employeeIds.map((employeeId) => ({ rideId, employeeId })),
      skipDuplicates: true,
    });
    await createRidePax(rideId, input.employeeIds, input.scheduledPickupTimes);
  }

  // Start broadcast Redis key
  await startRideBroadcast(rideId);

  // Clear supervisor's pending cancellation fee — it's now baked into this ride's totalAmount
  if (pendingCancellationFee > 0) {
    await prisma.user.update({
      where: { id: input.supervisorId },
      data: { pendingCancellationFee: 0 },
    });
    logger.info({ rideId, pendingCancellationFee }, 'Pending cancellation fee baked into new ride totalAmount');
  }

  // Find nearby drivers (of the requested vehicle type) and broadcast
  const nearbyDrivers = await findNearbyDrivers(
    input.pickupPoint.lat,
    input.pickupPoint.lng,
    BROADCAST_RADIUS_KM,
    input.vehicleType,
  );

  logger.info({ rideId, nearbyCount: nearbyDrivers.length }, 'Ride created, broadcasting');

  // Emit to vendor rooms
  if (io && nearbyDrivers.length > 0) {
    // Group by vendor from DB
    const driverIds = nearbyDrivers.map((d) => d.id);
    const drivers = await prisma.driver.findMany({
      where: { id: { in: driverIds } },
      select: { id: true, vendorId: true },
    });

    const vendorIds = [...new Set(drivers.map((d) => d.vendorId))];
    const ridePayload = await getRidePublicPayload(rideId);

    for (const vendorId of vendorIds) {
      io.of('/driver').to(`vendor:${vendorId}`).emit('ride:broadcast', ridePayload);
    }

    // Also create offer records
    await prisma.rideOffer.createMany({
      data: driverIds.map((driverId) => ({ rideId, driverId, response: 'pending' })),
      skipDuplicates: true,
    });

    io.of('/supervisor')
      .to(`supervisor:${input.supervisorId}`)
      .emit('ride:status_changed', { rideId, status: 'broadcasting', nearbyCount: nearbyDrivers.length });
  }

  return { ride: { id: rideId, status: 'broadcasting' }, nearbyCount: nearbyDrivers.length };
}

/**
 * ATOMIC ride acceptance using SELECT FOR UPDATE SKIP LOCKED.
 * Only one driver wins when multiple concurrent requests arrive.
 */
export async function acceptRide(rideId: string, driverId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Lock the ride row — SKIP LOCKED means concurrent transactions won't block,
    // they'll just get an empty result set immediately
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status FROM rides
      WHERE id = ${rideId} AND status = 'broadcasting'
        AND (broadcast_expires_at IS NULL OR broadcast_expires_at > NOW())
      FOR UPDATE SKIP LOCKED
    `;

    if (rows.length === 0) {
      throw new ConflictError('Ride already taken, expired, or not available');
    }

    // Assign driver and update status atomically
    await tx.$executeRaw`
      UPDATE rides
      SET status = 'assigned',
          driver_id = ${driverId},
          accepted_at = NOW()
      WHERE id = ${rideId}
    `;

    // Get driver's vendor
    const driver = await tx.driver.findUnique({
      where: { id: driverId },
      select: { vendorId: true },
    });

    if (driver) {
      await tx.$executeRaw`
        UPDATE rides SET vendor_id = ${driver.vendorId} WHERE id = ${rideId}
      `;
    }

    // Upsert offer record
    await tx.rideOffer.upsert({
      where: { rideId_driverId: { rideId, driverId } },
      create: { rideId, driverId, response: 'accepted' },
      update: { response: 'accepted' },
    });

    // Expire all other pending offers
    await tx.$executeRaw`
      UPDATE ride_offers
      SET response = 'expired'
      WHERE ride_id = ${rideId}
        AND driver_id != ${driverId}
        AND response = 'pending'
    `;
  });

  // Clean up Redis broadcast key
  await redis.del(`ride:broadcast:${rideId}`);

  // SMS both OTPs to all passengers now that a driver is confirmed
  await sendPaxOtpSms(rideId);

  logger.info({ rideId, driverId }, 'Ride accepted');
}

export async function rejectRide(rideId: string, driverId: string): Promise<void> {
  await prisma.rideOffer.upsert({
    where: { rideId_driverId: { rideId, driverId } },
    create: { rideId, driverId, response: 'rejected' },
    update: { response: 'rejected' },
  });
}

export const CANCELLATION_FEE_RATE = 0.05; // 5% of ride fare

export async function cancelRide(
  rideId: string,
  requestorId: string,
  requestorRole: string,
  force = false,
): Promise<{ cancellationFee: number | null }> {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new NotFoundError('Ride not found');

  if (!force && (ride.status === 'in_progress' || ride.status === 'completed')) {
    throw new ValidationError(`Cannot cancel ride with status: ${ride.status}`);
  }
  if (ride.status === 'completed') {
    throw new ValidationError('Cannot cancel a completed ride');
  }
  if (requestorRole === 'supervisor' && ride.supervisorId !== requestorId) {
    throw new ForbiddenError('You can only cancel your own rides');
  }
  if (!force && ride.scheduledFor && requestorRole === 'supervisor' &&
      ride.scheduledFor.getTime() - Date.now() < 3 * 60 * 60 * 1000) {
    throw new ForbiddenError('Cannot cancel a scheduled ride within 3 hours of it');
  }

  // ── Compute cancellation fee (supervisor only, not force-cancel) ──────────
  // Charged when: driver was assigned (status = 'assigned' or 'in_progress')
  // AND the requestor is a supervisor AND not an SOS force-cancel.
  let cancellationFee: number | null = null;
  const driverWasAssigned = ['assigned', 'in_progress'].includes(ride.status);

  if (!force && requestorRole === 'supervisor' && driverWasAssigned && ride.price) {
    cancellationFee = Math.round(ride.price * CANCELLATION_FEE_RATE * 100) / 100; // 5%, 2dp
  }

  const ops: any[] = [
    prisma.ride.update({
      where: { id: rideId },
      data: {
        status: 'cancelled',
        ...(cancellationFee != null ? { cancellationFee } : {}),
      },
    }),
  ];

  // Add fee to supervisor's pending balance
  if (cancellationFee != null) {
    ops.push(
      prisma.user.update({
        where: { id: ride.supervisorId },
        data: { pendingCancellationFee: { increment: cancellationFee } },
      }),
    );
    logger.info({ rideId, supervisorId: ride.supervisorId, cancellationFee },
      'Cancellation fee applied to supervisor pending balance');
  }

  await prisma.$transaction(ops);
  await redis.del(`ride:broadcast:${rideId}`);

  return { cancellationFee };
}

export async function advanceRideStatus(
  rideId: string,
  newStatus: string,
  requestorId: string,
  requestorRole: string,
): Promise<{ id: string; status: string }> {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new NotFoundError('Ride not found');

  // Validate transition
  const validTransitions: Record<string, string[]> = {
    assigned: ['in_progress'],
    in_progress: ['completed'],
    broadcasting: ['assigned', 'cancelled', 'expired'],
    pending: ['broadcasting', 'cancelled'],
  };

  const allowed = validTransitions[ride.status] ?? [];
  if (!allowed.includes(newStatus)) {
    throw new ValidationError(
      `Cannot transition from '${ride.status}' to '${newStatus}'`,
    );
  }

  // Permission checks
  if (requestorRole === 'driver') {
    if (ride.driverId !== requestorId) {
      throw new ForbiddenError('You are not the assigned driver for this ride');
    }
    if (!['in_progress', 'completed'].includes(newStatus)) {
      throw new ForbiddenError('Drivers can only advance ride to in_progress or completed');
    }
  } else if (requestorRole === 'supervisor') {
    if (ride.supervisorId !== requestorId) {
      throw new ForbiddenError('You can only update your own rides');
    }
  }

  const updateData: Record<string, unknown> = { status: newStatus };
  if (newStatus === 'in_progress') {
    updateData.startedAt = new Date();
  }
  if (newStatus === 'completed') {
    updateData.completedAt = new Date();
  }

  const updated = await prisma.ride.update({
    where: { id: rideId },
    data: updateData,
  });

  return { id: updated.id, status: updated.status };
}

export async function rebroadcastRide(
  rideId: string,
  requestorId: string,
  requestorRole: string,
  io?: IoServer,
): Promise<void> {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new NotFoundError('Ride not found');

  if (requestorRole === 'supervisor' && ride.supervisorId !== requestorId) {
    throw new ForbiddenError('You can only rebroadcast your own rides');
  }

  if (!['expired', 'cancelled'].includes(ride.status)) {
    throw new ValidationError('Only expired or cancelled rides can be rebroadcast');
  }

  await prisma.$executeRaw`
    UPDATE rides
    SET status = 'broadcasting',
        driver_id = NULL,
        broadcast_started_at = NOW(),
        broadcast_expires_at = NOW() + INTERVAL '3 minutes'
    WHERE id = ${rideId}
  `;

  await startRideBroadcast(rideId);

  if (io) {
    const ridePayload = await getRidePublicPayload(rideId);
    // Re-find nearby drivers and broadcast
    const pickupRows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(pickup_point::geometry) as lat, ST_X(pickup_point::geometry) as lng
      FROM rides WHERE id = ${rideId}
    `;
    if (pickupRows.length > 0) {
      const { lat, lng } = pickupRows[0];
      const nearbyDrivers = await findNearbyDrivers(lat, lng, BROADCAST_RADIUS_KM);
      const driverIds = nearbyDrivers.map((d) => d.id);
      const drivers = await prisma.driver.findMany({
        where: { id: { in: driverIds } },
        select: { id: true, vendorId: true },
      });
      const vendorIds = [...new Set(drivers.map((d) => d.vendorId))];
      for (const vendorId of vendorIds) {
        io.of('/driver').to(`vendor:${vendorId}`).emit('ride:broadcast', ridePayload);
      }
    }
  }
}

/**
 * Driver drops a ride they already accepted (status 'assigned').
 *
 * Previously there was no way out: a driver who broke down, fell ill, or
 * accepted by mistake had to simply not turn up, and the supervisor absorbed a
 * 5% cancellation fee for a situation the driver caused. This gives them an
 * honest exit while keeping the ride fillable.
 *
 * The ride goes back to 'broadcasting' rather than 'cancelled' so nearby
 * drivers can claim it immediately — the employees still need transport. For a
 * SCHEDULED ride, driverReleaseScheduledRide() is the correct path instead
 * (it returns the ride to the marketplace and applies the notice-based fine).
 *
 * Fine: charged only once the driver has confirmed arrival, since at that point
 * the supervisor believes the cab is at the pickup and has stopped looking for
 * alternatives. Dropping the ride before arriving is free — an early, honest
 * release is the behaviour we want, not something to punish.
 */
export async function driverCancelAssignedRide(
  rideId: string,
  driverId: string,
  reason: string,
  io?: IoServer,
): Promise<{ fine: number; rebroadcast: boolean }> {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new NotFoundError('Ride not found');
  if (ride.driverId !== driverId) throw new ForbiddenError('Not your ride');
  if (ride.status !== 'assigned') {
    throw new ValidationError(
      ride.status === 'in_progress'
        ? 'Trip already started — contact your supervisor'
        : `Cannot drop a ride with status: ${ride.status}`,
    );
  }
  if (ride.scheduledFor) {
    throw new ValidationError('Use release for scheduled rides');
  }

  const fine = ride.driverReportingTime ? DRIVER_DROP_AFTER_ARRIVAL_FINE : 0;

  await prisma.$transaction(async (tx) => {
    // Back to the marketplace, driver detached, offers cleared so the previous
    // driver isn't re-offered their own dropped ride.
    await tx.$executeRaw`
      UPDATE rides
      SET status = 'broadcasting',
          driver_id = NULL,
          vendor_id = NULL,
          driver_reporting_time = NULL,
          broadcast_started_at = NOW(),
          broadcast_expires_at = NOW() + INTERVAL '3 minutes'
      WHERE id = ${rideId}
    `;
    await tx.rideOffer.deleteMany({ where: { rideId } });

    if (fine > 0) {
      await tx.driver.update({
        where: { id: driverId },
        data: { walletBalance: { decrement: fine } },
      });
      await tx.driverFine.create({
        data: {
          driverId,
          rideId,
          amount: fine,
          reason: 'assigned_drop_after_arrival',
          notes: `Dropped an accepted ride after confirming arrival. Reason given: ${reason}`,
        },
      });
    }
  });

  // Register the broadcast window in Redis and push the offer to nearby
  // drivers, exactly as a fresh broadcast would.
  await startRideBroadcast(rideId);

  if (io) {
    const ridePayload = await getRidePublicPayload(rideId);
    const pickupRows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(pickup_point::geometry) as lat, ST_X(pickup_point::geometry) as lng
      FROM rides WHERE id = ${rideId}
    `;
    if (pickupRows.length > 0) {
      const { lat, lng } = pickupRows[0];
      const nearby = await findNearbyDrivers(lat, lng, BROADCAST_RADIUS_KM);
      // Exclude the driver who just dropped it — re-offering them their own
      // abandoned ride is noise at best.
      const drivers = await prisma.driver.findMany({
        where: { id: { in: nearby.map((d) => d.id).filter((id) => id !== driverId) } },
        select: { vendorId: true },
      });
      for (const vendorId of [...new Set(drivers.map((d) => d.vendorId))]) {
        io.of('/driver').to(`vendor:${vendorId}`).emit('ride:broadcast', ridePayload);
      }
    }
  }

  logger.warn({ rideId, driverId, fine, reason }, 'Driver dropped an assigned ride');
  return { fine, rebroadcast: true };
}

// Scheduled-ride marketplace: a driver claims an unassigned scheduled ride.
export async function claimScheduledRide(rideId: string, driverId: string): Promise<void> {
  // Claim window closes 4 hours before the ride.
  const r = await prisma.ride.findUnique({ where: { id: rideId }, select: { scheduledFor: true } });
  if (r?.scheduledFor && r.scheduledFor.getTime() - Date.now() < 4 * 60 * 60 * 1000) {
    throw new ForbiddenError('Too late to claim — under 4 hours to the ride');
  }
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM rides WHERE id = ${rideId} AND status = 'scheduled'
      FOR UPDATE SKIP LOCKED
    `;
    if (rows.length === 0) throw new ConflictError('Ride already claimed or not available');

    const driver = await tx.driver.findUnique({ where: { id: driverId }, select: { vendorId: true } });
    await tx.$executeRaw`
      UPDATE rides SET status = 'assigned', driver_id = ${driverId}, vendor_id = ${driver?.vendorId ?? null}, claimed_at = NOW()
      WHERE id = ${rideId}
    `;
  });
  logger.info({ rideId, driverId }, 'Scheduled ride claimed');
}

/**
 * Driver releases a claimed scheduled ride, putting it back on the marketplace.
 *
 * The fine is based on NOTICE GIVEN before the scheduled pickup, not on how
 * long the driver held the ride. The previous rule (free if released within 3h
 * of *claiming*) had it backwards: it fined a driver who released 3 days early
 * after holding the ride overnight, but let someone off free for claiming 2h
 * before pickup and bailing 30 minutes later — the far more damaging case.
 *
 * See releaseFine() in lib/pricing.ts for the bands.
 */
export async function driverReleaseScheduledRide(
  rideId: string,
  driverId: string,
): Promise<{ fine: number; hoursNotice: number; bucket: string }> {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new NotFoundError('Ride not found');
  if (ride.driverId !== driverId) throw new ForbiddenError('Not your ride');
  if (!ride.scheduledFor) throw new ValidationError('Only scheduled rides can be released');
  // Once the trip is underway the driver can't hand it back — a supervisor has
  // to cancel it, so the passengers' situation is handled deliberately.
  if (ride.status === 'in_progress') {
    throw new ValidationError('Trip already started — contact your supervisor to cancel');
  }

  const { fine, bucket, hoursNotice } = releaseFine(ride.scheduledFor);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE rides SET status = 'scheduled', driver_id = NULL, vendor_id = NULL, claimed_at = NULL
      WHERE id = ${rideId}
    `;
    if (fine > 0) {
      // Wallet debit and its audit record are written together — a fine can
      // never hit the balance without a matching row explaining it.
      await tx.driver.update({
        where: { id: driverId },
        data: { walletBalance: { decrement: fine } },
      });
      await tx.driverFine.create({
        data: {
          driverId,
          rideId,
          amount: fine,
          reason: `scheduled_release_${bucket}`,
          notes: `Released a claimed scheduled ride with ${hoursNotice}h notice before pickup.`,
        },
      });
    }
  });

  logger.info({ rideId, driverId, fine, bucket, hoursNotice }, 'Driver released scheduled ride');
  return { fine, hoursNotice, bucket };
}

// Drivers near a ride's pickup — for the supervisor's manual-assign popup.
// Excludes drivers who are already on an assigned or in_progress ride.
export async function nearbyDriversForRide(rideId: string, radiusKm: number) {
  const rows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
    SELECT ST_Y(pickup_point::geometry) as lat, ST_X(pickup_point::geometry) as lng FROM rides WHERE id = ${rideId}
  `;
  if (rows.length === 0) throw new NotFoundError('Ride not found');
  const { lat, lng } = rows[0];
  const drivers = await prisma.$queryRaw<Array<{
    id: string; full_name: string; phone: string; rating: number; vehicle_type: string | null;
    is_online: boolean; reg_no: string | null; capacity: number | null; fuel_type: string | null; distance_m: number;
  }>>`
    SELECT d.id, d.full_name, d.phone, d.rating, d.vehicle_type, d.is_online,
           v.reg_no, v.capacity, v.fuel_type,
           ST_Distance(d.current_location, ST_Point(${lng}, ${lat})::geography) as distance_m
    FROM drivers d
    LEFT JOIN vehicles v ON v.id = d.vehicle_id
    WHERE d.is_online = true
      AND d.status = 'active'
      AND d.kyc_status = 'approved'
      AND d.current_location IS NOT NULL
      AND ST_DWithin(d.current_location, ST_Point(${lng}, ${lat})::geography, ${radiusKm * 1000})
      -- Only show drivers not currently on an active ride
      AND d.id NOT IN (
        SELECT driver_id FROM rides
        WHERE driver_id IS NOT NULL
          AND status IN ('assigned', 'in_progress')
      )
    ORDER BY distance_m
    LIMIT 20
  `;
  return drivers.map((d) => ({
    id: d.id, fullName: d.full_name, phone: d.phone, rating: d.rating, vehicleType: d.vehicle_type,
    isOnline: d.is_online, regNo: d.reg_no, capacity: d.capacity, fuelType: d.fuel_type,
    distanceKm: Math.round(d.distance_m / 100) / 10,
  }));
}

// Supervisor/admin manually assigns a ride to a specific driver (optional price override).
export async function manualAssignRide(
  rideId: string, driverId: string, price: number | undefined,
  requestorId: string, requestorRole: string,
): Promise<void> {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new NotFoundError('Ride not found');
  if (requestorRole === 'supervisor' && ride.supervisorId !== requestorId) {
    throw new ForbiddenError('You can only assign your own rides');
  }
  if (!['scheduled', 'pending', 'expired', 'broadcasting', 'cancelled'].includes(ride.status)) {
    throw new ValidationError(`Cannot assign a ride with status: ${ride.status}`);
  }
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { vendorId: true } });
  if (!driver) throw new NotFoundError('Driver not found');
  await prisma.$executeRaw`
    UPDATE rides
    SET status = 'assigned', driver_id = ${driverId}, vendor_id = ${driver.vendorId},
        price = COALESCE(${price ?? null}, price),
        accepted_at = NOW()
    WHERE id = ${rideId}
  `;
  await redis.del(`ride:broadcast:${rideId}`);

  // Ensure per-passenger OTP legs exist (older rides may predate ride_pax).
  const paxCount = await prisma.ridePax.count({ where: { rideId } });
  if (paxCount === 0) {
    const emps = await prisma.rideEmployee.findMany({ where: { rideId } });
    await createRidePax(rideId, emps.map((e) => e.employeeId));
  }

  // SMS both OTPs to all passengers now that a driver is manually assigned
  await sendPaxOtpSms(rideId);
}

export async function listScheduledRidesForDriver(vehicleType?: string | null) {
  const cutoff = new Date(Date.now() + 4 * 60 * 60 * 1000); // claim window closes 4h before
  const where: Record<string, unknown> = { status: 'scheduled', scheduledFor: { gt: cutoff } };
  if (vehicleType) where.OR = [{ vehicleType: null }, { vehicleType }];
  return prisma.ride.findMany({
    where,
    include: {
      supervisor: { select: { fullName: true, org: true } },
      rideEmployees: { include: { employee: { select: { name: true } } } },
    },
    orderBy: { scheduledFor: 'asc' },
  });
}

// Expire stale scheduled rides: unclaimed ones past their time, and claimed
// ones never started more than 1h after their time (driver no-show).
//
// Driver no-shows are fined. Without this, simply ghosting the ride was the
// cheapest option available to a driver — releasing it properly cost ₹100-200,
// while never turning up cost nothing at all.
export async function sweepStaleScheduledRides(): Promise<void> {
  // Claimed-but-never-started rides, captured before we expire them so we know
  // which drivers to charge.
  const noShows = await prisma.$queryRaw<Array<{ id: string; driver_id: string; scheduled_for: Date }>>`
    SELECT id, driver_id, scheduled_for
    FROM rides
    WHERE status = 'assigned'
      AND scheduled_for IS NOT NULL
      AND scheduled_for < NOW() - INTERVAL '1 hour'
      AND driver_id IS NOT NULL
  `;

  await prisma.$executeRaw`
    UPDATE rides SET status = 'expired'
    WHERE (status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for < NOW())
       OR (status = 'assigned' AND scheduled_for IS NOT NULL AND scheduled_for < NOW() - INTERVAL '1 hour')
  `;

  for (const r of noShows) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.driver.update({
          where: { id: r.driver_id },
          data: { walletBalance: { decrement: SCHEDULED_NO_SHOW_FINE } },
        });
        await tx.driverFine.create({
          data: {
            driverId: r.driver_id,
            rideId: r.id,
            amount: SCHEDULED_NO_SHOW_FINE,
            reason: 'scheduled_no_show',
            notes: 'Claimed a scheduled ride and never started it (no-show).',
          },
        });
      });
      logger.warn({ rideId: r.id, driverId: r.driver_id, fine: SCHEDULED_NO_SHOW_FINE },
        'Scheduled-ride no-show fine applied');
    } catch (err) {
      // One bad driver row shouldn't stop the sweeper expiring the rest.
      logger.error({ err, rideId: r.id, driverId: r.driver_id }, 'Failed to apply no-show fine');
    }
  }
}

export async function listRides(filters: {
  role: string;
  userId?: string;
  driverId?: string;
  vendorId?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  // NOTE: sweepStaleScheduledRides() was removed from here — it ran on every
  // list call and caused unnecessary write load. It now runs only in the
  // broadcastSweeper interval (server.ts).
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};

  if (filters.role === 'supervisor') {
    where.supervisorId = filters.userId;
  } else if (filters.role === 'vendor') {
    where.vendorId = filters.vendorId;
  } else if (filters.role === 'driver') {
    where.driverId = filters.driverId;
  }
  // admin sees all

  if (filters.status) where.status = filters.status;

  const [rides, total] = await Promise.all([
    prisma.ride.findMany({
      where,
      skip,
      take: limit,
      include: {
        supervisor: { select: { fullName: true, email: true } },
        driver: { select: { fullName: true, phone: true } },
        rideEmployees: { include: { employee: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.ride.count({ where }),
  ]);

  return { rides, total, page, limit };
}

export async function getRide(id: string) {
  const ride = await prisma.ride.findUnique({
    where: { id },
    include: {
      supervisor: { select: { fullName: true, email: true } },
      driver: { select: { fullName: true, phone: true } },
      vendor: { select: { name: true } },
      rideEmployees: { include: { employee: true } },
      rideOffers: { include: { driver: { select: { fullName: true, phone: true } } } },
    },
  });
  if (!ride) throw new NotFoundError('Ride not found');

  // Extract drop + pickup lat/lng from PostGIS geography columns.
  // Prisma returns geography as an opaque buffer, so we use a raw query.
  const coords = await prisma.$queryRaw<
    Array<{
      drop_lat: number;
      drop_lng: number;
      pickup_lat: number;
      pickup_lng: number;
    }>
  >`
    SELECT
      ST_Y(drop_point::geometry)   AS drop_lat,
      ST_X(drop_point::geometry)   AS drop_lng,
      ST_Y(pickup_point::geometry) AS pickup_lat,
      ST_X(pickup_point::geometry) AS pickup_lng
    FROM rides
    WHERE id = ${id}
  `;

  const { drop_lat, drop_lng, pickup_lat, pickup_lng } = coords[0] ?? {
    drop_lat: null, drop_lng: null, pickup_lat: null, pickup_lng: null,
  };

  return {
    ...ride,
    dropLat: drop_lat,
    dropLng: drop_lng,
    pickupLat: pickup_lat,
    pickupLng: pickup_lng,
  };
}

async function getRidePublicPayload(rideId: string) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      type: string;
      status: string;
      pickup_address: string;
      drop_address: string;
      pax_count: number;
      capacity: number;
      price: number | null;
      distance_km: number | null;
      escort_required: boolean;
      escort_charge: number | null;
      scheduled_for: Date | null;
      broadcast_expires_at: Date | null;
      pickup_lat: number;
      pickup_lng: number;
    }>
  >`
    SELECT
      id, type, status, pickup_address, drop_address, pax_count, capacity,
      price, distance_km, escort_required, escort_charge,
      scheduled_for, broadcast_expires_at,
      ST_Y(pickup_point::geometry) as pickup_lat,
      ST_X(pickup_point::geometry) as pickup_lng
    FROM rides
    WHERE id = ${rideId}
  `;
  return rows[0] ?? null;
}

// ─── Completed-ride full detail ───────────────────────────────────────────────
// Returns ride metadata + driver + supervisor + all employees with pickup/drop
// status + the GPS breadcrumb trail recorded during the trip.

export interface RideDetailResult {
  id: string;
  type: string;
  status: string;
  pickupAddress: string;
  dropAddress: string;
  pickupLat: number | null;
  pickupLng: number | null;
  dropLat: number | null;
  dropLng: number | null;
  distanceKm: number | null;
  price: number | null;
  vehicleType: string | null;
  paxCount: number;
  capacity: number;
  createdAt: Date;
  completedAt: Date | null;
  scheduledFor: Date | null;
  acceptedAt: Date | null;
  startedAt: Date | null;
  plannedStartTime: Date | null;
  driverReportingTime: Date | null;
  escortRequired: boolean;
  escortName: string | null;
  supervisor: { fullName: string; email: string; phone: string | null; org: string | null } | null;
  driver: {
    id: string;
    fullName: string;
    phone: string;
    rating: number;
    vehicleType: string | null;
    vehicle: { regNo: string; capacity: number; fuelType: string } | null;
  } | null;
  vendor: { name: string } | null;
  passengers: Array<{
    seq: number;
    name: string;
    empId: string;
    gender: string;
    phone: string | null;
    pickupAddress: string;
    dropAddress: string;
    pickedAt: Date | null;
    droppedAt: Date | null;
    noShow: boolean;
  }>;
  /** GPS breadcrumbs ordered chronologically — empty if no location was logged. */
  locationTrail: Array<{ lat: number; lng: number; recordedAt: Date }>;
}

export async function getRideDetail(rideId: string): Promise<RideDetailResult> {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      supervisor: { select: { fullName: true, email: true, phone: true, org: true } },
      driver: {
        select: {
          id: true, fullName: true, phone: true, rating: true, vehicleType: true,
          vehicle: { select: { regNo: true, capacity: true, fuelType: true } },
        },
      },
      vendor: { select: { name: true } },
      pax: {
        orderBy: { seq: 'asc' },
        include: {
          employee: {
            select: { empId: true, name: true, gender: true, phone: true, pickupAddress: true, dropAddress: true },
          },
        },
      },
      locationLogs: {
        orderBy: { recordedAt: 'asc' },
        select: { lat: true, lng: true, recordedAt: true },
      },
    },
  });

  if (!ride) throw new NotFoundError('Ride not found');

  // Extract lat/lng from PostGIS geography columns
  const coords = await prisma.$queryRaw<Array<{
    pickup_lat: number; pickup_lng: number; drop_lat: number; drop_lng: number;
  }>>`
    SELECT
      ST_Y(pickup_point::geometry) AS pickup_lat,
      ST_X(pickup_point::geometry) AS pickup_lng,
      ST_Y(drop_point::geometry)   AS drop_lat,
      ST_X(drop_point::geometry)   AS drop_lng
    FROM rides WHERE id = ${rideId}
  `;
  const { pickup_lat, pickup_lng, drop_lat, drop_lng } = coords[0] ?? {};

  return {
    id: ride.id,
    type: ride.type,
    status: ride.status,
    pickupAddress: ride.pickupAddress,
    dropAddress: ride.dropAddress,
    pickupLat: pickup_lat ?? null,
    pickupLng: pickup_lng ?? null,
    dropLat: drop_lat ?? null,
    dropLng: drop_lng ?? null,
    distanceKm: ride.distanceKm,
    price: ride.price,
    vehicleType: ride.vehicleType,
    paxCount: ride.paxCount,
    capacity: ride.capacity,
    createdAt: ride.createdAt,
    completedAt: ride.completedAt,
    scheduledFor: ride.scheduledFor,
    acceptedAt: ride.acceptedAt,
    startedAt: ride.startedAt,
    plannedStartTime: ride.plannedStartTime,
    driverReportingTime: ride.driverReportingTime,
    escortRequired: ride.escortRequired,
    escortName: ride.escortName,
    supervisor: ride.supervisor,
    driver: ride.driver,
    vendor: ride.vendor,
    passengers: ride.pax.map((p) => ({
      seq: p.seq,
      name: p.employee.name,
      empId: p.employee.empId,
      gender: p.employee.gender,
      phone: p.employee.phone ?? null,
      pickupAddress: p.employee.pickupAddress,
      dropAddress: p.employee.dropAddress,
      pickedAt: p.pickedAt,
      droppedAt: p.droppedAt,
      noShow: p.noShow,
    })),
    locationTrail: ride.locationLogs,
  };
}
