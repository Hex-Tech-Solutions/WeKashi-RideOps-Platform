// Rental_Service — supervisor books a rental (Sedan/SUV) for a named customer;
// it broadcasts fleet-wide to eligible opted-in drivers. A driver accepting it
// consumes one ride credit (same economy as normal rides). Drivers may cancel
// (release) a rental they accepted, returning it to the marketplace.

import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { getRentalPack, type RentalVehicle } from '../lib/rentalPacks';
import { NotFoundError, ValidationError, ConflictError } from '../types';
import { logger } from '../lib/logger';

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

  const hasPoint = input.pickupPoint != null;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO rentals (
      id, supervisor_id, customer_name, customer_phone, vehicle_type, package_key,
      hours, km, base_price, extra_per_km, extra_per_hr,
      pickup_address, pickup_point, scheduled_for, status, notes, created_at
    ) VALUES (
      gen_random_uuid(), ${input.supervisorId}, ${input.customerName}, ${input.customerPhone},
      ${input.vehicleType}, ${pack.key},
      ${pack.hours}, ${pack.km}, ${pack.basePrice}, ${pack.extraPerKm}, ${pack.extraPerHr},
      ${input.pickupAddress},
      ${hasPoint ? Prisma.sql`ST_SetSRID(ST_MakePoint(${input.pickupPoint!.lng}, ${input.pickupPoint!.lat}), 4326)::geography` : Prisma.sql`NULL`},
      ${input.scheduledFor ?? null},
      'broadcasting', ${input.notes ?? null}, NOW()
    )
    RETURNING id
  `;
  logger.info({ rentalId: rows[0].id, supervisorId: input.supervisorId }, 'Rental booked');
  return { id: rows[0].id };
}

// Supervisor's rentals (newest first).
export async function listRentalsForSupervisor(supervisorId: string) {
  return prisma.rental.findMany({
    where: { supervisorId },
    include: { driver: { select: { fullName: true, phone: true } } },
    orderBy: { createdAt: 'desc' },
  });
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

  return prisma.rental.findMany({
    where: { status: 'broadcasting', vehicleType: driver.vehicleType },
    include: { supervisor: { select: { fullName: true, org: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

// Rentals the driver currently holds (accepted / in progress).
export async function listDriverRentals(driverId: string) {
  return prisma.rental.findMany({
    where: { driverId, status: { in: ['assigned', 'in_progress'] } },
    orderBy: { createdAt: 'desc' },
  });
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
      await tx.$executeRaw`UPDATE credit_packs SET credits_remaining = credits_remaining - 1 WHERE id = ${pack[0].id}`;
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
    const rows = await tx.$queryRaw<Array<{ credit_consumed: boolean }>>`
      SELECT credit_consumed FROM rentals
      WHERE id = ${rentalId} AND driver_id = ${driverId}
        AND status IN ('assigned', 'in_progress')
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundError('Rental not found or not yours');

    // Refund the credit to the driver's newest active pack.
    if (rows[0].credit_consumed) {
      const pack = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM credit_packs
        WHERE driver_id = ${driverId} AND status = 'active' AND expires_at > NOW()
        ORDER BY expires_at DESC, created_at DESC
        LIMIT 1 FOR UPDATE SKIP LOCKED
      `;
      if (pack.length > 0) {
        await tx.$executeRaw`UPDATE credit_packs SET credits_remaining = credits_remaining + 1 WHERE id = ${pack[0].id}`;
      }
    }

    await tx.$executeRaw`
      UPDATE rentals
      SET status = 'broadcasting', driver_id = NULL, accepted_at = NULL, credit_consumed = false
      WHERE id = ${rentalId}
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
