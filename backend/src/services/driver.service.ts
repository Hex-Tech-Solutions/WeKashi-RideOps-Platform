import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { NotFoundError, ForbiddenError, NearbyDriver } from '../types';
import { logger } from '../lib/logger';
import { bufferDriverLocation } from '../lib/locationBuffer';

export interface CreateDriverInput {
  phone: string;
  fullName: string;
  vendorId: string;
  vehicleId?: string;
}

export async function createDriver(input: CreateDriverInput) {
  return prisma.driver.create({
    data: {
      phone: input.phone,
      fullName: input.fullName,
      vendorId: input.vendorId,
      vehicleId: input.vehicleId,
      status: 'pending',
      kycStatus: 'pending',
    },
  });
}

export async function listDrivers(filters: {
  vendorId?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters.vendorId) where.vendorId = filters.vendorId;
  if (filters.status) where.status = filters.status;

  const [drivers, total] = await Promise.all([
    prisma.driver.findMany({
      where,
      skip,
      take: limit,
      include: { vendor: { select: { name: true } }, vehicle: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.driver.count({ where }),
  ]);

  return { drivers, total, page, limit };
}

export async function getDriver(id: string) {
  const driver = await prisma.driver.findUnique({
    where: { id },
    include: { vendor: { select: { name: true, vendorCode: true } }, vehicle: true },
  });
  if (!driver) throw new NotFoundError('Driver not found');

  // Attach the list of document types that are verified but now past their
  // expiry date — used by the driver app to show targeted warnings.
  const expiredDocs = await prisma.driverDocument.findMany({
    where: {
      driverId: id,
      status: 'verified',
      expiry: { not: null, lt: new Date() },
    },
    select: { type: true },
  });

  return {
    ...driver,
    expiredDocTypes: expiredDocs.map((d) => d.type),
  };
}

export async function updateDriverStatus(
  id: string,
  status: 'pending' | 'active' | 'blacklisted' | 'expired',
  requestorVendorId?: string,
) {
  const driver = await prisma.driver.findUnique({ where: { id } });
  if (!driver) throw new NotFoundError('Driver not found');

  if (requestorVendorId && driver.vendorId !== requestorVendorId) {
    throw new ForbiddenError('You can only update drivers belonging to your vendor');
  }

  return prisma.driver.update({
    where: { id },
    data: { status },
  });
}

export async function updateDriverLocation(
  driverId: string,
  lat: number,
  lng: number,
  io?: import('socket.io').Server,
): Promise<void> {
  // ── Find active ride (lightweight read — still needed for Socket.io emit) ──
  const activeRide = await prisma.ride.findFirst({
    where: { driverId, status: { in: ['in_progress', 'assigned'] } },
    select: { id: true, supervisorId: true, status: true },
  });

  // ── Buffer position in Redis (bulk DB write happens every 60s) ────────────
  // This replaces the direct DB write on every ping.
  await bufferDriverLocation(
    driverId,
    lat,
    lng,
    activeRide?.id ?? null,
    activeRide?.status === 'in_progress',
  );

  // ── Socket.io: emit to supervisor immediately (real-time, no buffer) ──────
  if (io && activeRide) {
    io.of('/supervisor')
      .to(`supervisor:${activeRide.supervisorId}`)
      .emit('driver:location_update', {
        rideId:   activeRide.id,
        driverId,
        lat,
        lng,
        ts: Date.now(),
      });
  }

  logger.debug({ driverId, lat, lng }, 'Driver location buffered');
}

// All online cabs with a known GPS position — for the admin live map.
export async function listLiveDriverLocations() {
  const rows = await prisma.$queryRaw<Array<{
    id: string; full_name: string; vehicle_type: string | null; status: string;
    is_online: boolean; lat: number; lng: number;
  }>>`
    SELECT id, full_name, vehicle_type, status, is_online,
      ST_Y(current_location::geometry) as lat,
      ST_X(current_location::geometry) as lng
    FROM drivers
    WHERE is_online = true AND current_location IS NOT NULL
  `;
  return rows.map((r) => ({
    id: r.id, fullName: r.full_name, vehicleType: r.vehicle_type,
    status: r.status, isOnline: r.is_online, lat: r.lat, lng: r.lng,
  }));
}

export async function findNearbyDrivers(
  lat: number,
  lng: number,
  radiusKm: number,
  vehicleType?: string | null,
): Promise<NearbyDriver[]> {
  const vt = vehicleType ?? null;
  const drivers = await prisma.$queryRaw<NearbyDriver[]>`
    SELECT id, full_name, rating, vehicle_id,
      ST_Distance(current_location, ST_Point(${lng}, ${lat})::geography) as distance_m
    FROM drivers
    WHERE is_online = true
      AND status = 'active'
      AND kyc_status = 'approved'
      AND current_location IS NOT NULL
      AND (${vt}::text IS NULL OR vehicle_type = ${vt})
      AND ST_DWithin(
        current_location,
        ST_Point(${lng}, ${lat})::geography,
        ${radiusKm * 1000}
      )
      -- Exclude drivers already on an active ride
      AND id NOT IN (
        SELECT driver_id FROM rides
        WHERE driver_id IS NOT NULL
          AND status IN ('assigned', 'in_progress')
      )
    ORDER BY distance_m
    LIMIT 20
  `;
  return drivers;
}

// Count online, active, KYC-approved, available (no active ride) drivers by vehicle type.
export async function vehicleAvailability(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<Array<{ vehicle_type: string | null; count: bigint }>>`
    SELECT vehicle_type, COUNT(*)::bigint as count
    FROM drivers
    WHERE is_online = true
      AND status = 'active'
      AND kyc_status = 'approved'
      AND current_location IS NOT NULL
      AND vehicle_type IS NOT NULL
      AND ST_DWithin(current_location, ST_Point(${lng}, ${lat})::geography, ${radiusKm * 1000})
      AND id NOT IN (
        SELECT driver_id FROM rides
        WHERE driver_id IS NOT NULL
          AND status IN ('assigned', 'in_progress')
      )
    GROUP BY vehicle_type
  `;
  const out: Record<string, number> = {};
  for (const r of rows) if (r.vehicle_type) out[r.vehicle_type] = Number(r.count);
  return out;
}

export async function setDriverOnlineStatus(
  driverId: string,
  isOnline: boolean,
): Promise<void> {
  await prisma.driver.update({
    where: { id: driverId },
    data: { isOnline },
  });
}

// Rides currently broadcasting that this driver has a pending offer for.
// No cap — every eligible pending offer is returned; the driver app renders
// this as a scrollable list. Soonest-expiring first, since those need action
// first.
export async function listDriverOffers(driverId: string) {
  const offers = await prisma.rideOffer.findMany({
    where: { driverId, response: 'pending', ride: { status: 'broadcasting' } },
    include: {
      ride: {
        select: {
          id: true,
          type: true,
          status: true,
          pickupAddress: true,
          dropAddress: true,
          paxCount: true,
          capacity: true,
          price: true,
          escortRequired: true,
          escortCharge: true,
          escortName: true,
          distanceKm: true,
          broadcastExpiresAt: true,
          plannedStartTime: true,
          createdAt: true,
        },
      },
    },
    orderBy: { ride: { broadcastExpiresAt: 'asc' } },
  });
  if (offers.length === 0) return [];

  // Pickup coordinates so the app can show how far the driver is from each
  // pickup. Prisma can't select PostGIS geography columns, hence the raw query.
  const ids = offers.map((o) => o.ride.id);
  const coords = await prisma.$queryRaw<Array<{ id: string; pickup_lat: number; pickup_lng: number }>>`
    SELECT id,
           ST_Y(pickup_point::geometry) AS pickup_lat,
           ST_X(pickup_point::geometry) AS pickup_lng
    FROM rides
    WHERE id IN (${Prisma.join(ids)})
  `;
  const byId = new Map(coords.map((c) => [c.id, c]));

  // First pickup's scheduled time — the earliest stop (lowest seq) that has a
  // supervisor-set pickup time. Shown on the offer card so the driver knows
  // when the first employee expects to be collected.
  const firstPickups = await prisma.ridePax.findMany({
    where: { rideId: { in: ids }, scheduledPickupTime: { not: null } },
    orderBy: { seq: 'asc' },
    select: { rideId: true, scheduledPickupTime: true },
  });
  const firstPickupByRide = new Map<string, string>();
  for (const p of firstPickups) {
    if (!firstPickupByRide.has(p.rideId) && p.scheduledPickupTime) {
      firstPickupByRide.set(p.rideId, p.scheduledPickupTime);
    }
  }

  return offers.map((o) => ({
    ...o.ride,
    pickupLat: byId.get(o.ride.id)?.pickup_lat ?? null,
    pickupLng: byId.get(o.ride.id)?.pickup_lng ?? null,
    firstPickupTime: firstPickupByRide.get(o.ride.id) ?? null,
  }));
}

// Total count of pending offers for this driver — used to show "N available"
// on the Rides tab badge without re-deriving it from the (already uncapped)
// offers list on every render.
export async function countDriverOffers(driverId: string): Promise<number> {
  return prisma.rideOffer.count({
    where: { driverId, response: 'pending', ride: { status: 'broadcasting' } },
  });
}
