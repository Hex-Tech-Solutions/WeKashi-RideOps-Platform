// Rental_Service — supervisor books a rental (Sedan/SUV) for a named customer;
// it broadcasts fleet-wide to eligible opted-in drivers. A driver accepting it
// consumes one ride credit (same economy as normal rides). Drivers may cancel
// (release) a rental they accepted, returning it to the marketplace.

import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { Prisma } from '@prisma/client';
import { getRentalPack, computeRentalOverage, type RentalVehicle } from '../lib/rentalPacks';
import { NotFoundError, ValidationError, ConflictError } from '../types';
import { logger } from '../lib/logger';
import { randomInt } from 'crypto';

// A driver's dismissed rentals persist across refreshes (so a declined card
// doesn't reappear) via a Redis set keyed by driver. Entries auto-expire after
// a day — long enough to outlast a rental's broadcast window, short enough not
// to accumulate forever. The filter is applied in listEligibleRentalsForDriver.
const DISMISS_TTL_SEC = 24 * 60 * 60;
const dismissKey = (driverId: string) => `rental:dismissed:${driverId}`;

export async function dismissRentalForDriver(driverId: string, rentalId: string): Promise<void> {
  const key = dismissKey(driverId);
  await redis.sadd(key, rentalId);
  await redis.expire(key, DISMISS_TTL_SEC);
}

// 4-digit OTPs, same format as employee pickup/drop OTPs.
const gen4 = () => String(randomInt(1000, 10000));

// Minimum per-segment distance (metres) that counts toward the odometer.
// Below this, a GPS reading is treated as stationary jitter, not real travel —
// without this a parked vehicle accumulates phantom kilometres.
const GPS_JITTER_M = 15;

export interface CreateRentalInput {
  supervisorId: string;
  customerName: string;
  customerPhone: string;
  vehicleType: RentalVehicle;
  packageKey: string;
  pickupAddress: string;
  pickupPoint?: { lat: number; lng: number };
  scheduledFor?: Date;
  notes?: string;
}

export async function createRental(input: CreateRentalInput): Promise<{ id: string }> {
  const pack = getRentalPack(input.packageKey);
  if (!pack) throw new ValidationError('Invalid rental package');
  if (pack.vehicleType !== input.vehicleType) {
    throw new ValidationError('Package does not match the selected vehicle type');
  }
  // A scheduled rental can't be in the past (allow a 1-minute skew). Mirrors the
  // normal scheduled-ride rule; a blank scheduledFor means "dispatch now".
  if (input.scheduledFor && input.scheduledFor.getTime() < Date.now() - 60_000) {
    throw new ValidationError('Scheduled pickup time cannot be in the past');
  }

  const hasPoint = input.pickupPoint != null;
  // Pickup + drop OTPs are generated up front and surfaced only on the
  // supervisor's Rental Ride card — the supervisor reads them out verbally.
  const pickupOtp = gen4();
  const dropOtp = gen4();
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO rentals (
      id, supervisor_id, customer_name, customer_phone, vehicle_type, package_key,
      hours, km, base_price, extra_per_km, extra_per_hr,
      pickup_address, pickup_point, scheduled_for, status, notes,
      pickup_otp, drop_otp, created_at
    ) VALUES (
      gen_random_uuid(), ${input.supervisorId}, ${input.customerName}, ${input.customerPhone},
      ${input.vehicleType}, ${pack.key},
      ${pack.hours}, ${pack.km}, ${pack.basePrice}, ${pack.extraPerKm}, ${pack.extraPerHr},
      ${input.pickupAddress},
      ${hasPoint ? Prisma.sql`ST_SetSRID(ST_MakePoint(${input.pickupPoint!.lng}, ${input.pickupPoint!.lat}), 4326)::geography` : Prisma.sql`NULL`},
      ${input.scheduledFor ?? null},
      'broadcasting', ${input.notes ?? null},
      ${pickupOtp}, ${dropOtp}, NOW()
    )
    RETURNING id
  `;
  logger.info({ rentalId: rows[0].id, supervisorId: input.supervisorId }, 'Rental booked');
  return { id: rows[0].id };
}

// ── Rental Rides lifecycle ────────────────────────────────────────────────────

/**
 * Driver confirms arrival at the pickup location (slider). Only valid on an
 * assigned rental the driver holds. Idempotent — re-confirming is a no-op.
 */
export async function rentalArrived(rentalId: string, driverId: string): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE rentals SET arrived_at = COALESCE(arrived_at, NOW())
    WHERE id = ${rentalId} AND driver_id = ${driverId} AND status = 'assigned'
    RETURNING id
  `;
  if (rows.length === 0) throw new NotFoundError('Rental not found or not in a state to confirm arrival');
  logger.info({ rentalId, driverId }, 'Rental arrival confirmed');
}

/**
 * Driver enters the pickup OTP (given verbally by the supervisor). On success
 * the rental goes in_progress and the timer + GPS tracking start.
 */
export async function startRental(rentalId: string, driverId: string, otp: string): Promise<{ startedAt: string }> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    select: { driverId: true, status: true, pickupOtp: true, arrivedAt: true },
  });
  if (!rental || rental.driverId !== driverId) throw new NotFoundError('Rental not found');
  if (rental.status !== 'assigned') throw new ValidationError('This rental is not ready to start');
  if (!rental.arrivedAt) throw new ValidationError('Confirm arrival before entering the pickup OTP');
  if (rental.pickupOtp !== otp) throw new ValidationError('Incorrect pickup OTP');

  const updated = await prisma.rental.update({
    where: { id: rentalId },
    data: { status: 'in_progress', startedAt: new Date() },
    select: { startedAt: true },
  });
  logger.info({ rentalId, driverId }, 'Rental started (pickup OTP verified)');
  return { startedAt: updated.startedAt!.toISOString() };
}

/**
 * Driver agrees to the overage pop-up once the package limit (hours or km) is
 * reached. Stamps overage_started_at so both apps show when billing began.
 */
export async function agreeRentalOverage(rentalId: string, driverId: string): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE rentals
    SET overage_agreed = true, overage_started_at = COALESCE(overage_started_at, NOW())
    WHERE id = ${rentalId} AND driver_id = ${driverId} AND status = 'in_progress'
    RETURNING id
  `;
  if (rows.length === 0) throw new NotFoundError('Rental not found or not in progress');
  logger.info({ rentalId, driverId }, 'Rental overage agreed');
}

/**
 * Live progress for an in-progress rental: elapsed minutes, GPS-odometer
 * distance, and the current overage. Used by both the driver and supervisor
 * cards (polled). Distance is the summed geodesic length of the breadcrumb
 * trail since pickup.
 */
export async function getRentalProgress(rentalId: string) {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    select: {
      packageKey: true, status: true, startedAt: true, completedAt: true,
      overageAgreed: true, overageStartedAt: true, hours: true, km: true,
      distanceM: true, overageAmount: true, totalAmount: true, basePrice: true,
    },
  });
  if (!rental) throw new NotFoundError('Rental not found');

  // Live GPS odometer: sum distance between consecutive breadcrumbs, but DROP
  // segments under GPS_JITTER_M — a stationary phone's GPS drifts a few metres
  // per reading, and summing that noise manufactures phantom kilometres.
  const dist = await prisma.$queryRaw<Array<{ meters: number }>>`
    SELECT COALESCE(SUM(seg), 0)::float AS meters FROM (
      SELECT ST_Distance(
        point,
        LAG(point) OVER (ORDER BY recorded_at)
      ) AS seg
      FROM rental_location_logs
      WHERE rental_id = ${rentalId}
    ) s
    WHERE seg >= ${GPS_JITTER_M}
  `;
  const liveMeters = rental.status === 'completed' ? rental.distanceM : (dist[0]?.meters ?? 0);
  const distanceKm = Math.round((liveMeters / 1000) * 10) / 10;

  const startedAt = rental.startedAt ? rental.startedAt.getTime() : null;
  const endRef = rental.completedAt ? rental.completedAt.getTime() : Date.now();
  const elapsedMin = startedAt ? Math.max(0, Math.round((endRef - startedAt) / 60000)) : 0;

  const overage = computeRentalOverage(rental.packageKey, elapsedMin, distanceKm);
  const limitReached = elapsedMin >= rental.hours * 60 || distanceKm >= rental.km;

  return {
    status: rental.status,
    elapsedMin,
    distanceKm,
    includedHours: rental.hours,
    includedKm: rental.km,
    limitReached,
    overageAgreed: rental.overageAgreed,
    overageStartedAt: rental.overageStartedAt?.toISOString() ?? null,
    overage,
    basePrice: rental.basePrice,
    // When completed these are the frozen final values.
    finalOverageAmount: rental.status === 'completed' ? rental.overageAmount : overage.overageAmount,
    finalTotal: rental.status === 'completed' ? rental.totalAmount : rental.basePrice + overage.overageAmount,
  };
}

/**
 * Driver enters the drop OTP (verbal) to complete the rental. Freezes the final
 * distance + overage + total. The drop OTP always completes the ride — the
 * passenger may end it early (under the pack) or late (over the pack); any
 * overage is billed into the final total. There is no agreement gate.
 */
export async function completeRental(rentalId: string, driverId: string, otp: string): Promise<{ total: number }> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    select: {
      driverId: true, status: true, dropOtp: true, packageKey: true,
      startedAt: true, hours: true, km: true, basePrice: true,
    },
  });
  if (!rental || rental.driverId !== driverId) throw new NotFoundError('Rental not found');
  if (rental.status !== 'in_progress') throw new ValidationError('This rental is not in progress');
  if (rental.dropOtp !== otp) throw new ValidationError('Incorrect drop OTP');

  // Final GPS odometer — same jitter floor as the live query.
  const dist = await prisma.$queryRaw<Array<{ meters: number }>>`
    SELECT COALESCE(SUM(seg), 0)::float AS meters FROM (
      SELECT ST_Distance(point, LAG(point) OVER (ORDER BY recorded_at)) AS seg
      FROM rental_location_logs WHERE rental_id = ${rentalId}
    ) s
    WHERE seg >= ${GPS_JITTER_M}
  `;
  const meters = dist[0]?.meters ?? 0;
  const distanceKm = Math.round((meters / 1000) * 10) / 10;
  const elapsedMin = rental.startedAt ? Math.max(0, Math.round((Date.now() - rental.startedAt.getTime()) / 60000)) : 0;
  const overage = computeRentalOverage(rental.packageKey, elapsedMin, distanceKm);

  // The drop OTP ALWAYS completes the ride — the passenger ends it whenever
  // they want, under or over the pack limit. Any overage is simply billed into
  // the final total; it is never a precondition. The overage pop-up on the
  // driver app is a notification only (overageAgreed is an informational stamp,
  // not a gate).
  const total = rental.basePrice + overage.overageAmount;
  await prisma.rental.update({
    where: { id: rentalId },
    data: {
      status: 'completed',
      completedAt: new Date(),
      distanceM: meters,
      overageHours: overage.overHours,
      overageKm: overage.overKm,
      overageAmount: overage.overageAmount,
      totalAmount: total,
    },
  });
  logger.info({ rentalId, driverId, distanceKm, overage: overage.overageAmount, total }, 'Rental completed (drop OTP verified)');
  return { total };
}

/**
 * Driver closes a rental because the customer never showed up. Only valid on a
 * rental the driver holds that has NOT started (status 'assigned') — once the
 * pickup OTP is entered the trip is underway and must be completed normally.
 *
 * The rental is marked completed and billed at HALF the base price to
 * compensate the driver for turning up; the burned credit is NOT refunded (the
 * driver still did the work of accepting + driving to pickup). Flows through the
 * same post-completion pipeline (Payments + history) as any completed rental.
 * Returns the half-fare total + the supervisorId so the caller can notify them.
 */
export async function closeRentalNoShow(
  rentalId: string,
  driverId: string,
): Promise<{ total: number; supervisorId: string }> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    select: { driverId: true, status: true, basePrice: true, supervisorId: true },
  });
  if (!rental || rental.driverId !== driverId) throw new NotFoundError('Rental not found');
  if (rental.status !== 'assigned') {
    throw new ValidationError('A no-show can only be reported before the ride starts');
  }

  // Half the base package price, rounded to the rupee.
  const total = Math.round(rental.basePrice / 2);
  await prisma.rental.update({
    where: { id: rentalId },
    data: {
      status: 'completed',
      noShow: true,
      completedAt: new Date(),
      distanceM: 0,
      overageHours: 0,
      overageKm: 0,
      overageAmount: 0,
      totalAmount: total,
    },
  });
  logger.info({ rentalId, driverId, total }, 'Rental closed as customer no-show (half fare)');
  return { total, supervisorId: rental.supervisorId };
}

/**
 * Expire rentals that were never accepted by their scheduled pickup time.
 * A broadcasting rental with a scheduledFor in the past is retired to
 * 'expired' (parallel to how unclaimed scheduled rides are swept). No credit is
 * involved (nobody accepted it). Returns the affected rentals so the caller can
 * notify each supervisor.
 */
export async function expireStaleRentals(): Promise<Array<{ id: string; supervisorId: string }>> {
  const stale = await prisma.$queryRaw<Array<{ id: string; supervisor_id: string }>>`
    UPDATE rentals
    SET status = 'expired'
    WHERE status = 'broadcasting'
      AND scheduled_for IS NOT NULL
      AND scheduled_for < NOW()
    RETURNING id, supervisor_id
  `;
  if (stale.length > 0) {
    logger.info({ count: stale.length }, 'Expired unaccepted rentals past their scheduled time');
  }
  return stale.map((r) => ({ id: r.id, supervisorId: r.supervisor_id }));
}

/** Append a GPS breadcrumb for an in-progress rental (the odometer source). */
export async function logRentalLocation(rentalId: string, driverId: string, lat: number, lng: number): Promise<void> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    select: { driverId: true, status: true },
  });
  if (!rental || rental.driverId !== driverId || rental.status !== 'in_progress') return; // silently ignore stale pings
  await prisma.$executeRaw`
    INSERT INTO rental_location_logs (id, rental_id, point, recorded_at)
    VALUES (gen_random_uuid(), ${rentalId}, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, NOW())
  `;
}

/**
 * Full detail for a completed (or in-progress) rental, including the GPS
 * breadcrumb TRAIL recorded during the trip — the rental analogue of
 * getRideDetail. Lets the supervisor review the exact route driven and export
 * a receipt, matching what normal/airport rides offer.
 */
export async function getRentalDetail(rentalId: string) {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: {
      driver: {
        select: {
          fullName: true, phone: true, vehicleType: true,
          vehicle: { select: { regNo: true, fuelType: true } },
        },
      },
      supervisor: { select: { fullName: true, org: true, phone: true } },
    },
  });
  if (!rental) throw new NotFoundError('Rental not found');

  // Pickup point (geography) + the ordered breadcrumb trail.
  const pickupRows = await prisma.$queryRaw<Array<{ lat: number | null; lng: number | null }>>`
    SELECT ST_Y(pickup_point::geometry) AS lat, ST_X(pickup_point::geometry) AS lng
    FROM rentals WHERE id = ${rentalId}
  `;
  const trail = await prisma.$queryRaw<Array<{ lat: number; lng: number; recorded_at: Date }>>`
    SELECT ST_Y(point::geometry) AS lat, ST_X(point::geometry) AS lng, recorded_at
    FROM rental_location_logs
    WHERE rental_id = ${rentalId}
    ORDER BY recorded_at ASC
  `;

  // Elapsed — in whole seconds, so a sub-minute trip is not shown as 0.
  const startedAt = rental.startedAt ? rental.startedAt.getTime() : null;
  const endRef = rental.completedAt ? rental.completedAt.getTime() : Date.now();
  const elapsedSec = startedAt ? Math.max(0, Math.round((endRef - startedAt) / 1000)) : 0;

  return {
    id: rental.id,
    status: rental.status,
    customerName: rental.customerName,
    customerPhone: rental.customerPhone,
    vehicleType: rental.vehicleType,
    packageKey: rental.packageKey,
    hours: rental.hours,
    km: rental.km,
    basePrice: rental.basePrice,
    pickupAddress: rental.pickupAddress,
    pickupLat: pickupRows[0]?.lat ?? null,
    pickupLng: pickupRows[0]?.lng ?? null,
    scheduledFor: rental.scheduledFor,
    createdAt: rental.createdAt,
    acceptedAt: rental.acceptedAt,
    startedAt: rental.startedAt,
    completedAt: rental.completedAt,
    elapsedSec,
    distanceM: rental.distanceM,
    distanceKm: Math.round((rental.distanceM / 1000) * 10) / 10,
    overageHours: rental.overageHours,
    overageKm: rental.overageKm,
    overageAmount: rental.overageAmount,
    totalAmount: rental.totalAmount,
    noShow: rental.noShow,
    paymentStatus: rental.paymentStatus,
    paymentRef: rental.paymentRef,
    paidAt: rental.paidAt,
    paymentReceivedAt: rental.paymentReceivedAt,
    driver: rental.driver,
    supervisor: rental.supervisor,
    locationTrail: trail.map((t) => ({ lat: t.lat, lng: t.lng, recordedAt: t.recorded_at })),
  };
}

// Supervisor's rentals (newest first). Includes the full driver + vehicle
// details and the OTPs — this is the ONLY place OTPs are surfaced, so the
// supervisor can read them out to the driver. For assigned rentals (driver en
// route), also computes a rough driver→pickup ETA from the driver's last known
// GPS position (straight-line distance; a cheap, no-API estimate).
export async function listRentalsForSupervisor(supervisorId: string) {
  const rentals = await prisma.rental.findMany({
    where: { supervisorId },
    include: {
      driver: {
        select: {
          fullName: true, phone: true, vehicleType: true,
          vehicle: { select: { regNo: true, fuelType: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Straight-line driver→pickup distance for assigned rentals with both points.
  const assignedIds = rentals.filter((r) => r.status === 'assigned' && r.driverId).map((r) => r.id);
  const etaByRental = new Map<string, { etaKm: number; etaMin: number }>();
  if (assignedIds.length > 0) {
    const rows = await prisma.$queryRaw<Array<{ id: string; meters: number | null }>>`
      SELECT r.id,
             ST_Distance(d.current_location, r.pickup_point) AS meters
      FROM rentals r
      JOIN drivers d ON d.id = r.driver_id
      WHERE r.id IN (${Prisma.join(assignedIds)})
        AND d.current_location IS NOT NULL
        AND r.pickup_point IS NOT NULL
    `;
    for (const row of rows) {
      if (row.meters == null) continue;
      const etaKm = Math.round((row.meters / 1000) * 10) / 10;
      // ~22 km/h average city speed → minutes; floor of 1 min.
      const etaMin = Math.max(1, Math.round((etaKm / 22) * 60));
      etaByRental.set(row.id, { etaKm, etaMin });
    }
  }

  return rentals.map((r) => ({ ...r, eta: etaByRental.get(r.id) ?? null }));
}

/**
 * Rentals a driver is eligible to see & accept. Fleet-wide (no proximity).
 * Eligibility: rental is broadcasting, matches the driver's vehicle type, the
 * driver is online + active + approved + opted-in + has ≥1 credit + not on an
 * active ride.
 */
export async function listEligibleRentalsForDriver(driverId: string) {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: {
      vehicleType: true, status: true, kycStatus: true, isOnline: true, rentalOptIn: true,
    },
  });
  if (!driver) throw new NotFoundError('Driver not found');

  // Hard gates — if any fail, the driver sees no rentals.
  if (
    !driver.isOnline ||
    driver.status !== 'active' ||
    driver.kycStatus !== 'approved' ||
    !driver.rentalOptIn ||
    (driver.vehicleType !== 'sedan' && driver.vehicleType !== 'suv')
  ) {
    return [];
  }

  const credits = await prisma.$queryRaw<Array<{ total: number }>>`
    SELECT COALESCE(SUM(credits_remaining), 0)::int AS total
    FROM credit_packs
    WHERE driver_id = ${driverId} AND status = 'active'
      AND credits_remaining > 0 AND expires_at > NOW()
  `;
  if ((credits[0]?.total ?? 0) < 1) return [];

  // Not on an active ride.
  const active = await prisma.ride.count({
    where: { driverId, status: { in: ['assigned', 'in_progress'] }, queuedBehindRideId: null },
  });
  if (active > 0) return [];

  // Drop rentals this driver has dismissed (persisted in Redis so a declined
  // card stays hidden across refreshes).
  const dismissed = await redis.smembers(dismissKey(driverId));

  const rentals = await prisma.rental.findMany({
    where: {
      status: 'broadcasting',
      vehicleType: driver.vehicleType,
      ...(dismissed.length > 0 ? { id: { notIn: dismissed } } : {}),
    },
    select: DRIVER_RENTAL_SELECT,
    orderBy: { createdAt: 'desc' },
  });
  return rentals;
}

// Fields safe to return to the driver app. Critically this OMITS pickup_otp
// and drop_otp — those live only on the supervisor's card; the driver types
// them in. Includes the lifecycle state the driver card needs.
const DRIVER_RENTAL_SELECT = {
  id: true, customerName: true, customerPhone: true, vehicleType: true,
  packageKey: true, hours: true, km: true, basePrice: true, extraPerKm: true,
  extraPerHr: true, pickupAddress: true, scheduledFor: true, status: true,
  notes: true, createdAt: true, acceptedAt: true, arrivedAt: true,
  startedAt: true, overageStartedAt: true, overageAgreed: true, completedAt: true,
  supervisor: { select: { fullName: true, org: true } },
} satisfies Prisma.RentalSelect;

// Rentals the driver currently holds (accepted / in progress).
export async function listDriverRentals(driverId: string) {
  return prisma.rental.findMany({
    where: { driverId, status: { in: ['assigned', 'in_progress'] } },
    select: DRIVER_RENTAL_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

// Completed rentals for the driver's trip history — includes the final figures
// and the payment receipt (UTR last-4 + received flag). Still omits OTPs.
export async function listDriverRentalHistory(driverId: string, limit = 30) {
  return prisma.rental.findMany({
    where: { driverId, status: 'completed' },
    select: {
      id: true, customerName: true, customerPhone: true, vehicleType: true,
      packageKey: true, hours: true, km: true, basePrice: true, extraPerKm: true,
      extraPerHr: true, pickupAddress: true, status: true, notes: true,
      startedAt: true, completedAt: true, distanceM: true,
      overageHours: true, overageKm: true, overageAmount: true, totalAmount: true,
      noShow: true,
      paymentStatus: true, paymentRef: true, paidAt: true, paymentReceivedAt: true,
    },
    orderBy: { completedAt: 'desc' },
    take: limit,
  });
}

// Driver confirms they received the direct UPI payment for a completed rental.
export async function markRentalReceived(rentalId: string, driverId: string): Promise<void> {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    select: { driverId: true, paymentStatus: true },
  });
  if (!rental || rental.driverId !== driverId) throw new NotFoundError('Rental not found');
  if (rental.paymentStatus !== 'paid') throw new ValidationError('No payment recorded yet');
  await prisma.rental.update({ where: { id: rentalId }, data: { paymentReceivedAt: new Date() } });
}

/**
 * Driver accepts a rental. Atomically: claim the broadcasting rental (first
 * come, first served) AND burn one ride credit. Idempotent on credit via
 * rentals.credit_consumed.
 */
export async function acceptRental(rentalId: string, driverId: string): Promise<{ accepted: true }> {
  await prisma.$transaction(async (tx) => {
    // Lock + claim only if still broadcasting.
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE rentals
      SET status = 'assigned', driver_id = ${driverId}, accepted_at = NOW()
      WHERE id = ${rentalId} AND status = 'broadcasting'
      RETURNING id
    `;
    if (rows.length === 0) {
      throw new ConflictError('This rental is no longer available');
    }

    // Burn one credit (oldest-expiring first), idempotent via credit_consumed.
    const r = await tx.$queryRaw<Array<{ credit_consumed: boolean }>>`
      SELECT credit_consumed FROM rentals WHERE id = ${rentalId} FOR UPDATE
    `;
    if (r.length > 0 && !r[0].credit_consumed) {
      const pack = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM credit_packs
        WHERE driver_id = ${driverId} AND status = 'active'
          AND credits_remaining > 0 AND expires_at > NOW()
        ORDER BY expires_at ASC, created_at ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
      if (pack.length === 0) {
        throw new ValidationError('No ride credits available — buy a pack to accept rentals');
      }
      // Decrement and flip to 'exhausted' at zero — consistent with
      // consumeOneCredit (ride completion), so a drained pack isn't left
      // showing 'active' with 0 credits.
      await tx.$executeRaw`
        UPDATE credit_packs
        SET credits_remaining = credits_remaining - 1,
            status = CASE WHEN credits_remaining - 1 <= 0 THEN 'exhausted' ELSE status END
        WHERE id = ${pack[0].id}
      `;
      await tx.$executeRaw`UPDATE rentals SET credit_consumed = true WHERE id = ${rentalId}`;
    }
  });
  logger.info({ rentalId, driverId }, 'Rental accepted');
  return { accepted: true };
}

/**
 * Driver cancels (releases) a rental they hold — it returns to broadcasting so
 * another eligible driver can take it. The consumed credit is refunded.
 */
export async function releaseRental(rentalId: string, driverId: string): Promise<{ released: true }> {
  await prisma.$transaction(async (tx) => {
    // Only a rental that has NOT started yet (status 'assigned') can be
    // released back to the marketplace. Releasing an in-progress rental would
    // strand the customer mid-trip and discard the timer/odometer so far — the
    // driver must complete it (drop OTP) instead. The UI only shows Release in
    // the assigned stage; this makes the backend enforce the same rule.
    const rows = await tx.$queryRaw<Array<{ credit_consumed: boolean }>>`
      SELECT credit_consumed FROM rentals
      WHERE id = ${rentalId} AND driver_id = ${driverId}
        AND status = 'assigned'
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundError('Rental not found, not yours, or already in progress');

    // Refund the burned credit. Refund to the OLDEST-expiring active pack —
    // the SAME ordering acceptRental burns from — so repeated accept/release
    // churn can no longer migrate credits onto longer-lived packs (which was a
    // free validity-extension loophole). Reactivate the pack if the decrement
    // had exhausted it.
    if (rows[0].credit_consumed) {
      let pack = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM credit_packs
        WHERE driver_id = ${driverId}
          AND status IN ('active', 'exhausted')
          AND expires_at > NOW()
        ORDER BY expires_at ASC, created_at ASC
        LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
      // Fallback: no unexpired pack to receive it — don't DESTROY the credit.
      // Put it back on the driver's most recent pack (reactivated), so the
      // refund is never silently lost.
      if (pack.length === 0) {
        pack = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM credit_packs
          WHERE driver_id = ${driverId}
          ORDER BY expires_at DESC, created_at DESC
          LIMIT 1 FOR UPDATE SKIP LOCKED
        `;
      }
      if (pack.length > 0) {
        await tx.$executeRaw`
          UPDATE credit_packs
          SET credits_remaining = credits_remaining + 1,
              status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END
          WHERE id = ${pack[0].id}
        `;
      }
    }

    await tx.$executeRaw`
      UPDATE rentals
      SET status = 'broadcasting', driver_id = NULL, accepted_at = NULL, arrived_at = NULL, credit_consumed = false
      WHERE id = ${rentalId} AND status = 'assigned'
    `;
  });
  logger.info({ rentalId, driverId }, 'Rental released by driver');
  return { released: true };
}

// Supervisor cancels a rental entirely.
export async function cancelRental(rentalId: string, supervisorId: string): Promise<void> {
  const rental = await prisma.rental.findUnique({ where: { id: rentalId }, select: { supervisorId: true, status: true } });
  if (!rental) throw new NotFoundError('Rental not found');
  if (rental.supervisorId !== supervisorId) throw new ValidationError('Access denied');
  if (rental.status === 'completed') throw new ValidationError('Completed rentals cannot be cancelled');
  await prisma.rental.update({ where: { id: rentalId }, data: { status: 'cancelled' } });
}

/**
 * Supervisor permanently removes a rental row from their list. Only cancelled
 * or completed rentals can be deleted — live ones (broadcasting/assigned/in
 * progress) must be cancelled first so a driver isn't left holding a ghost.
 */
export async function removeRental(rentalId: string, supervisorId: string): Promise<void> {
  const rental = await prisma.rental.findUnique({ where: { id: rentalId }, select: { supervisorId: true, status: true } });
  if (!rental) throw new NotFoundError('Rental not found');
  if (rental.supervisorId !== supervisorId) throw new ValidationError('Access denied');
  if (!['cancelled', 'completed', 'expired'].includes(rental.status)) {
    throw new ValidationError('Only cancelled, completed or expired rentals can be deleted');
  }
  await prisma.rental.delete({ where: { id: rentalId } });
}

/**
 * Driver toggles their rental opt-in. Only Sedan/SUV drivers can opt in —
 * enabling it on any other vehicle type is rejected so the eligibility query
 * stays honest.
 */
export async function setRentalOptIn(driverId: string, optIn: boolean): Promise<{ rentalOptIn: boolean }> {
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { vehicleType: true },
  });
  if (!driver) throw new NotFoundError('Driver not found');
  if (optIn && driver.vehicleType !== 'sedan' && driver.vehicleType !== 'suv') {
    throw new ValidationError('Rentals are available only for Sedan or SUV vehicles');
  }
  const updated = await prisma.driver.update({
    where: { id: driverId },
    data: { rentalOptIn: optIn },
    select: { rentalOptIn: true },
  });
  return updated;
}
