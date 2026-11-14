import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { NotFoundError, ForbiddenError, ValidationError, NearbyDriver } from '../types';
import { logger } from '../lib/logger';
import { bufferDriverLocation } from '../lib/locationBuffer';
import { getDriverActiveRide } from '../lib/activeRideCache';
import { JOINING_BONUS_CREDITS } from '../lib/creditPacks';

// Next-ride queueing: a driver whose in-progress ride's drop is within this
// straight-line distance of their current location is "finishing" and becomes
// eligible to accept a new broadcast (held as a queued ride). Tunable.
export const FINISHING_DISTANCE_KM = 0.3;

export interface CreateDriverInput {
  /** Canonical +91 mobile (caller normalises + checks for duplicates). */
  phone: string;
  fullName: string;
  vendorId: string;
  /** Canonical reg no (caller validates + checks availability). */
  regNo: string;
}

/**
 * Vendor "Add driver" (#22). The vendor vouches for the driver, so the account
 * starts ACTIVE (no Approvals step) and can sign in with OTP straight away.
 * KYC is still pending, so the driver gets no rides until documents are
 * verified. The Vehicle row (reg no only) is created and linked atomically.
 */
export async function createDriver(input: CreateDriverInput) {
  const driver = await prisma.$transaction(async (tx) => {
    const vehicle = await tx.vehicle.create({ data: { vendorId: input.vendorId, regNo: input.regNo } });
    return tx.driver.create({
      data: {
        phone: input.phone,
        fullName: input.fullName,
        vendorId: input.vendorId,
        vehicleId: vehicle.id,
        status: 'active',
        kycStatus: 'pending',
        signupSource: 'vendor',
      },
    });
  });
  // No credits yet: the joining bonus is granted when KYC is first approved.
  return driver;
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

  // Deleted (removed) accounts and rejected sign-up requests are history only.
  const where: Record<string, unknown> = { status: { notIn: ['removed', 'rejected'] } };
  if (filters.vendorId) where.vendorId = filters.vendorId;
  if (filters.status && filters.status !== 'removed' && filters.status !== 'rejected') where.status = filters.status;

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

  // Joining bonus state for the driver app banner:
  //   granted      — already received
  //   awaiting_kyc — will be granted when KYC is first approved
  //   not_eligible — withheld (same person already had a bonus on another account)
  let joiningBonus: 'granted' | 'awaiting_kyc' | 'not_eligible' = 'granted';
  if (!driver.joiningBonusGrantedAt) {
    const withheld = await prisma.identityFlag.count({
      where: { kind: 'repeat_joining_bonus', driverId: id },
    });
    joiningBonus = withheld > 0 ? 'not_eligible' : 'awaiting_kyc';
  }

  // walletBalance is intentionally omitted — the in-app wallet has been removed.
  const { walletBalance: _walletBalance, ...driverPublic } = driver as typeof driver & { walletBalance?: number };
  return {
    ...driverPublic,
    expiredDocTypes: expiredDocs.map((d) => d.type),
    joiningBonus,
    joiningBonusCredits: JOINING_BONUS_CREDITS,
  };
}

export async function updateDriverStatus(
  id: string,
  status: 'pending' | 'active' | 'blacklisted' | 'expired',
  requestorVendorId?: string,
) {
  const driver = await prisma.driver.findUnique({ where: { id } });
  // A deleted account or rejected request can't be brought back — the person
  // signs up again.
  if (!driver || driver.status === 'removed' || driver.status === 'rejected') {
    throw new NotFoundError('Driver not found');
  }

  if (requestorVendorId && driver.vendorId !== requestorVendorId) {
    throw new ForbiddenError('You can only update drivers belonging to your vendor');
  }

  const updated = await prisma.driver.update({
    where: { id },
    data: { status },
  });

  // ── Session revocation ─────────────────────────────────────────────────────
  // Blacklisting/expiring a driver must cut off access immediately, not after
  // their 7-day refresh token runs out. We (a) revoke every refresh token so
  // they can't mint a new access token, and (b) set a short-lived Redis block
  // key that authenticate() checks, so their CURRENT (<=15 min) access token is
  // rejected on the very next request. Re-activating clears the block.
  const { revokeDriverAccess, clearDriverBlock } = await import('./sessionRevocation');
  if (status === 'blacklisted' || status === 'expired') {
    await revokeDriverAccess(id);
  } else if (status === 'active') {
    await clearDriverBlock(id);
    // No credits here: the joining bonus is granted only when KYC is first
    // approved (kyc.service / setDocumentStatus).
  }

  return updated;
}

/**
 * Delete (soft-remove) a driver account — the vendor's way to let a driver
 * move to another vendor.
 *
 * History (rides, payments, documents, credits) is kept. The phone is renamed
 * so the number — and every other identity key, which the duplicate checks
 * ignore on removed accounts — is free for a new sign-up.
 *
 * Rules:
 *  - A vendor can only delete their own drivers.
 *  - A BLACKLISTED driver can only be deleted by an admin, so deleting can't
 *    be used to wipe a blacklist.
 *  - Not allowed while the driver has any assigned / in-progress ride
 *    (including claimed scheduled rides) or rental.
 */
export async function removeDriver(
  driverId: string,
  actor: { role: 'vendor' | 'admin'; vendorId?: string },
): Promise<void> {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver || driver.status === 'removed' || driver.status === 'rejected') {
    throw new NotFoundError('Driver not found');
  }
  if (actor.role === 'vendor' && driver.vendorId !== actor.vendorId) {
    throw new ForbiddenError('You can only delete drivers belonging to your vendor');
  }
  if (driver.status === 'blacklisted' && actor.role !== 'admin') {
    throw new ForbiddenError('A blacklisted driver can only be deleted by an admin');
  }

  const [rides, rentals] = await Promise.all([
    prisma.ride.count({ where: { driverId, status: { in: ['assigned', 'in_progress'] } } }),
    prisma.rental.count({ where: { driverId, status: { in: ['assigned', 'in_progress'] } } }),
  ]);
  if (rides + rentals > 0) {
    throw new ValidationError(
      'This driver has rides or rentals assigned. They must finish or release them before the account can be deleted.',
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.driver.update({
      where: { id: driverId },
      data: {
        status: 'removed',
        removedAt: new Date(),
        // Keep the original number inside the renamed value for the record.
        phone: `removed:${driverId.slice(0, 8)}:${driver.phone}`,
        isOnline: false,
        locationUpdatedAt: null,
        fcmToken: null,
      },
    });
    // Withdraw any open ride offers.
    await tx.$executeRaw`
      UPDATE ride_offers SET response = 'expired'
      WHERE driver_id = ${driverId} AND response = 'pending'
    `;
    // Free the vehicle number for a new sign-up, unless another active driver
    // still uses this vehicle. The row is kept (rename) so trip history still
    // points at it.
    if (driver.vehicleId) {
      const others = await tx.driver.count({
        where: { vehicleId: driver.vehicleId, id: { not: driverId }, status: { notIn: ['removed', 'rejected'] } },
      });
      if (others === 0) {
        await tx.$executeRaw`
          UPDATE vehicles SET reg_no = ${'removed:' + driverId.slice(0, 8) + ':'} || reg_no
          WHERE id = ${driver.vehicleId} AND reg_no NOT LIKE 'removed:%'
        `;
      }
    }
  });

  const { revokeDriverAccess } = await import('./sessionRevocation');
  await revokeDriverAccess(driverId);
  logger.info({ driverId, by: actor.role }, 'Driver account removed');
}

export async function updateDriverLocation(
  driverId: string,
  lat: number,
  lng: number,
  io?: import('socket.io').Server,
): Promise<void> {
  // ── Find active ride (Redis-cached; invalidated on every ride state change) ─
  const activeRide = await getDriverActiveRide(driverId);

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
      -- Active-ride gate (next-ride queueing): block drivers on an active ride
      -- UNLESS they are FINISHING it — i.e. the ride is in_progress and the
      -- driver is within FINISHING_DISTANCE_KM (straight line) of its drop. A
      -- not-yet-started ('assigned') active ride never qualifies.
      AND NOT EXISTS (
        SELECT 1 FROM rides act
        WHERE act.driver_id = drivers.id
          AND act.queued_behind_ride_id IS NULL
          AND act.status IN ('assigned', 'in_progress')
          AND NOT (
            act.status = 'in_progress'
            AND ST_DWithin(
              drivers.current_location,
              act.drop_point,
              ${FINISHING_DISTANCE_KM * 1000}
            )
          )
      )
      -- At most one queued ride: block drivers who already hold one.
      AND NOT EXISTS (
        SELECT 1 FROM rides q
        WHERE q.driver_id = drivers.id
          AND q.status = 'assigned'
          AND q.queued_behind_ride_id IS NOT NULL
      )
      -- Active-rental gate: a driver on a rental (accepted → until drop OTP) is
      -- busy with a secondary service and must NOT receive normal broadcasts.
      -- Rentals are open-ended (no fixed drop), so there's no "finishing"
      -- exception — the driver frees up only when the rental completes.
      AND NOT EXISTS (
        SELECT 1 FROM rentals rt
        WHERE rt.driver_id = drivers.id
          AND rt.status IN ('assigned', 'in_progress')
      )
      -- Credit gate: at least one credit NOT already committed to an
      -- accepted/claimed ride that hasn't burned its credit yet (spareCredits).
      AND (
        SELECT COALESCE(SUM(cp.credits_remaining), 0) FROM credit_packs cp
        WHERE cp.driver_id = drivers.id
          AND cp.status = 'active'
          AND cp.credits_remaining > 0
          AND cp.expires_at > NOW()
      ) > (
        SELECT COUNT(*) FROM rides rr
        WHERE rr.driver_id = drivers.id
          AND rr.status IN ('assigned', 'in_progress')
          AND rr.credit_consumed = false
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
      -- Credit gate (same rule as spareCredits).
      AND (
        SELECT COALESCE(SUM(cp.credits_remaining), 0) FROM credit_packs cp
        WHERE cp.driver_id = drivers.id
          AND cp.status = 'active'
          AND cp.credits_remaining > 0
          AND cp.expires_at > NOW()
      ) > (
        SELECT COUNT(*) FROM rides rr
        WHERE rr.driver_id = drivers.id
          AND rr.status IN ('assigned', 'in_progress')
          AND rr.credit_consumed = false
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
    // Going online seeds the heartbeat immediately so there's never an
    // is_online=true / location_updated_at=NULL window the sweeper can't reason
    // about. Going offline clears it. While online, the 60s location flush keeps
    // it fresh (see locationBuffer.ts).
    data: { isOnline, locationUpdatedAt: isOnline ? new Date() : null },
  });
}

// Rides currently broadcasting that this driver has a pending offer for.
// No cap — every eligible pending offer is returned; the driver app renders
// this as a scrollable list. Soonest-expiring first, since those need action
// first.
export async function listDriverOffers(driverId: string) {
  // Safety net: a driver busy on a rental sees no broadcasts, even if offer
  // rows were created before they accepted the rental.
  const onRental = await prisma.rental.count({
    where: { driverId, status: { in: ['assigned', 'in_progress'] } },
  });
  if (onRental > 0) return [];

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
          isAc: true,
          vehicleType: true,
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
  const onRental = await prisma.rental.count({
    where: { driverId, status: { in: ['assigned', 'in_progress'] } },
  });
  if (onRental > 0) return 0;
  return prisma.rideOffer.count({
    where: { driverId, response: 'pending', ride: { status: 'broadcasting' } },
  });
}

/**
 * Nearby ONLINE cabs around a point, for the live booking-map overlay (the
 * "cars moving near the pickup" view like Rapido/Uber). Returns coordinates +
 * vehicle type + a coarse heading so the client can rotate the car icon.
 *
 * Deliberately lighter than findNearbyDrivers(): this is a visual availability
 * indicator, so it only requires online + active + approved + a GPS fix. It
 * intentionally does NOT apply the credit/active-ride/queued gates — the map is
 * showing "cabs in the area", not "who will get this exact broadcast".
 */
export interface NearbyCab {
  id: string;
  lat: number;
  lng: number;
  vehicleType: string | null;
  bearing: number | null; // degrees, 0 = north; null if unknown
}

export async function listNearbyCabs(
  lat: number,
  lng: number,
  radiusKm: number,
  vehicleType?: string | null,
): Promise<NearbyCab[]> {
  const vt = vehicleType ?? null;
  const rows = await prisma.$queryRaw<Array<{
    id: string; vehicle_type: string | null; lat: number; lng: number;
  }>>`
    SELECT id, vehicle_type,
      ST_Y(current_location::geometry) AS lat,
      ST_X(current_location::geometry) AS lng
    FROM drivers
    WHERE is_online = true
      AND status = 'active'
      AND kyc_status = 'approved'
      AND current_location IS NOT NULL
      AND (${vt}::text IS NULL OR vehicle_type = ${vt})
      AND ST_DWithin(current_location, ST_Point(${lng}, ${lat})::geography, ${radiusKm * 1000})
    ORDER BY ST_Distance(current_location, ST_Point(${lng}, ${lat})::geography)
    LIMIT 25
  `;
  // bearing is derived client-side from consecutive polls (the car rotates
  // toward its direction of travel), so it isn't queried here.
  return rows.map((r) => ({
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    vehicleType: r.vehicle_type,
    bearing: null,
  }));
}
