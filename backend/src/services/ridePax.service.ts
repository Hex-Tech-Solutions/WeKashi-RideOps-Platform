import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { NotFoundError, ForbiddenError, ValidationError, TooManyRequestsError } from '../types';
import { smsSender } from '../lib/sms';
import { logger } from '../lib/logger';
import { randomInt } from 'crypto';
import { consumeOneCredit } from './creditPack.service';
import { promoteQueuedRide } from '../lib/ridePromotion';
import { invalidateDriverActiveRide } from '../lib/activeRideCache';
import { firstPickupAt } from '../lib/rideTiming';

// Use crypto.randomInt for cryptographically secure OTPs
const gen4 = () => String(randomInt(1000, 10000));

// Generate per-passenger legs (ordered by the route) with pickup + drop OTPs.
export async function createRidePax(
  rideId: string,
  orderedEmployeeIds: string[],
  scheduledPickupTimes?: Record<string, string>, // empId → HH:MM
): Promise<void> {
  if (!orderedEmployeeIds.length) return;
  await prisma.ridePax.createMany({
    data: orderedEmployeeIds.map((employeeId, i) => ({
      rideId,
      employeeId,
      seq: i,
      pickupOtp: gen4(),
      dropOtp: gen4(),
      scheduledPickupTime: scheduledPickupTimes?.[employeeId] ?? null,
    })),
    skipDuplicates: true,
  });
}

/**
 * Send both OTPs to all passengers on a ride via SMS.
 * Called once the ride is assigned to a driver (auto or manual).
 * Best-effort — never throws.
 */
export async function sendPaxOtpSms(rideId: string, opts: { atTrigger?: boolean } = {}): Promise<void> {
  try {
    // The DLT ride template includes the vehicle number - resolve the assigned
    // driver's registration number once for the whole ride.
    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        scheduledFor: true,
        driverId: true,
        driver: { select: { vehicle: { select: { regNo: true } } } },
      },
    });
    // Scheduled rides are claimed days ahead, so the codes go out only at the
    // trigger (driver starts a login trip / arrives for a logout trip), once per
    // ride+driver. A replacement driver gets a fresh send with the new vehicle.
    if (ride?.scheduledFor) {
      if (!opts.atTrigger || !ride.driverId) return;
      try {
        await prisma.driverNoticeLog.create({
          data: { driverId: ride.driverId, kind: 'pax_otp_sms', ref: `${rideId}:${ride.driverId}` },
        });
      } catch {
        return; // already sent
      }
    }
    const vehicle = ride?.driver?.vehicle?.regNo ?? 'N/A';

    const paxList = await prisma.ridePax.findMany({
      where: { rideId },
      include: { employee: { select: { name: true, phone: true } } },
    });
    for (const p of paxList) {
      if (!p.employee.phone) continue;
      try {
        await smsSender.sendRideOtp(p.employee.phone, {
          vehicle,
          boardingOtp: p.pickupOtp,
          deboardingOtp: p.dropOtp,
        });
        logger.info({ rideId, employeeId: p.employeeId }, 'OTP SMS sent to employee');
      } catch (err) {
        logger.warn({ err, employeeId: p.employeeId }, 'Failed to send OTP SMS');
      }
    }
  } catch (err) {
    logger.warn({ err, rideId }, 'sendPaxOtpSms error');
  }
}

// Ordered pax with each employee's stop coordinates. An employee's
// `pickup_location` is always their home address and `drop_location` is
// always the shared office — that's fixed at employee-creation time, not
// per ride. So the per-employee stop (home) is `pickup_location` regardless
// of ride direction: for login rides they board at home, for logout rides
// they're dropped at home. The office itself is the ride-level pickup/drop
// endpoint, handled separately — never the per-employee stop. OTPs only for
// supervisor/admin.
export async function getRidePax(rideId: string, opts: { includeOtp: boolean }) {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: {
      type: true, scheduledFor: true, escortRequired: true, escortName: true,
      escortOtp: true, escortDroppedAt: true,
    },
  });
  if (!ride) throw new NotFoundError('Ride not found');

  const rows = await prisma.$queryRaw<Array<{
    id: string; seq: number; name: string; gender: string | null; emp_phone: string | null; sup_phone: string | null;
    pickup_otp: string; drop_otp: string; scheduled_pickup_time: string | null;
    picked_at: Date | null; dropped_at: Date | null; no_show: boolean; lat: number; lng: number;
    arrived_at: Date | null; no_show_at: Date | null;
  }>>`
    SELECT rp.id, rp.seq, e.name, e.gender, e.phone as emp_phone, u.phone as sup_phone,
      rp.pickup_otp, rp.drop_otp, rp.scheduled_pickup_time, rp.picked_at, rp.dropped_at, rp.no_show, rp.arrived_at, rp.no_show_at,
      ST_Y(e.pickup_location::geometry) as lat,
      ST_X(e.pickup_location::geometry) as lng
    FROM ride_pax rp
    JOIN employees e ON e.id = rp.employee_id
    JOIN rides r ON r.id = rp.ride_id
    JOIN users u ON u.id = r.supervisor_id
    WHERE rp.ride_id = ${rideId}
    ORDER BY rp.seq
  `;

  return {
    type: ride.type,
    escortRequired: ride.escortRequired,
    escortName: ride.escortName,
    escortDroppedAt: ride.escortDroppedAt,
    // Only visible to supervisor/admin (opts.includeOtp) — same gating as
    // employee pickup/drop OTPs. Never sent to the driver via this endpoint;
    // the driver gets it verbally from the supervisor.
    ...(opts.includeOtp ? { escortOtp: ride.escortOtp } : {}),
    pax: rows.map((r) => {
      const female = (r.gender ?? '').toLowerCase().startsWith('f');
      return {
        id: r.id,
        seq: r.seq,
        name: r.name,
        gender: r.gender,
        lat: r.lat,
        lng: r.lng,
        // Female employees: supervisor is the point of contact. Males: own number.
        contactLabel: female ? 'Supervisor (POC)' : r.name,
        contactPhone: female ? r.sup_phone : r.emp_phone,
        scheduledPickupTime: r.scheduled_pickup_time,
        pickedAt: r.picked_at,
        droppedAt: r.dropped_at,
        noShow: r.no_show,
        arrivedAt: r.arrived_at,
        noShowAt: r.no_show_at,
        // When the driver may mark this employee no-show (null until they have
        // confirmed arrival at this stop).
        noShowOpensAt: noShowOpensAt(r.arrived_at, ride.scheduledFor, ride.type, r.scheduled_pickup_time),
        ...(opts.includeOtp ? { pickupOtp: r.pickup_otp, dropOtp: r.drop_otp } : {}),
      };
    }),
  };
}

async function assertDriverRide(rideId: string, driverId: string) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new NotFoundError('Ride not found');
  if (ride.driverId !== driverId) throw new ForbiddenError('Not your ride');
  return ride;
}

async function loadPax(rideId: string, paxId: string) {
  const pax = await prisma.ridePax.findUnique({ where: { id: paxId } });
  if (!pax || pax.rideId !== rideId) throw new NotFoundError('Passenger not found');
  return pax;
}

/** Rate-limit OTP verification per passenger — max 5 attempts */
async function checkPaxOtpRateLimit(paxId: string): Promise<void> {
  const key = `pax:otp:attempts:${paxId}`;
  const attempts = await redis.incr(key);
  if (attempts === 1) await redis.expire(key, 3600); // 1 hour window
  if (attempts > 5) {
    throw new TooManyRequestsError('Too many OTP attempts for this passenger. Try again later.');
  }
}

// Auto-complete the ride once every passenger is dropped (logout only).
// Uses a conditional UPDATE to prevent race condition where two concurrent
// verifyDrop calls both read allDone=false before either commits.
//
// Escort rides (logout only) additionally require escort_dropped_at to be
// set — the escort boards at the office with the employees and must be
// verified dropped back at the office (via escortOtp) before the ride can
// complete. See verifyEscortDrop() below.
async function maybeComplete(rideId: string): Promise<void> {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    select: { type: true, status: true, escortRequired: true, driverId: true },
  });
  if (!ride || ride.type !== 'logout') return;
  if (!['assigned', 'in_progress'].includes(ride.status)) return;

  // Atomic: only complete if NO undropped, non-noshow passengers remain, AND
  // (no escort required OR the escort has been verified dropped). If this call
  // is the one that actually completes the ride, it ALSO burns exactly one
  // ride credit and promotes any queued next ride — all in one transaction, so
  // an auto-completed logout ride is treated identically to an explicit
  // advanceRideStatus('completed').
  const promotedRideId = await prisma.$transaction(async (tx) => {
    const completed = await tx.$executeRaw`
      UPDATE rides SET status = 'completed', completed_at = NOW()
      WHERE id = ${rideId}
        AND status IN ('assigned', 'in_progress')
        AND NOT EXISTS (
          SELECT 1 FROM ride_pax
          WHERE ride_id = ${rideId}
            AND no_show = false
            AND dropped_at IS NULL
        )
        AND (escort_required = false OR escort_dropped_at IS NOT NULL)
    `;
    // executeRaw returns the affected row count. 0 → not completed by this call.
    if (Number(completed) === 0 || !ride.driverId) return null;
    await consumeOneCredit(tx, ride.driverId, rideId);
    return promoteQueuedRide(tx, rideId, ride.driverId);
  });

  await invalidateDriverActiveRide(ride.driverId);

  if (promotedRideId) {
    await sendPaxOtpSms(promotedRideId);
  }
}

/**
 * Verify the escort's return-drop OTP and stamp escort_dropped_at.
 * The supervisor relays this OTP to the driver directly (visible in the
 * supervisor console's trip detail) after confirming with the escort in
 * person — it is never sent to the escort automatically (no phone on file).
 * Calling maybeComplete() afterward lets the ride auto-complete immediately
 * if all employees were already dropped before this call.
 */
export async function verifyEscortDrop(rideId: string, otp: string, driverId: string) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new NotFoundError('Ride not found');
  if (ride.driverId !== driverId) throw new ForbiddenError('Not your ride');
  if (!ride.escortRequired) throw new ValidationError('This ride does not have an escort');
  if (ride.escortDroppedAt) throw new ValidationError('Escort drop already verified');
  if (!ride.escortOtp) throw new ValidationError('No escort OTP set for this ride');

  // Rate-limit the same way pax OTPs are — max 5 attempts.
  const rateLimitKey = `ride:escort-otp:attempts:${rideId}`;
  const attempts = await redis.incr(rateLimitKey);
  if (attempts === 1) await redis.expire(rateLimitKey, 3600);
  if (attempts > 5) {
    throw new TooManyRequestsError('Too many OTP attempts for escort drop. Try again later.');
  }

  if (ride.escortOtp !== otp) throw new ValidationError('Incorrect escort OTP');
  await redis.del(rateLimitKey);

  await prisma.ride.update({ where: { id: rideId }, data: { escortDroppedAt: new Date() } });
  await maybeComplete(rideId);
  return { ok: true };
}

export async function verifyPickup(rideId: string, paxId: string, otp: string, driverId: string) {
  await assertDriverRide(rideId, driverId);
  const pax = await loadPax(rideId, paxId);
  await checkPaxOtpRateLimit(paxId);
  if (pax.pickupOtp !== otp) throw new ValidationError('Incorrect pickup OTP');
  // Clear rate limit on success
  await redis.del(`pax:otp:attempts:${paxId}`);
  await prisma.ridePax.update({ where: { id: paxId }, data: { pickedAt: new Date(), noShow: false } });
  await maybeComplete(rideId);
  return { ok: true };
}

export async function verifyDrop(rideId: string, paxId: string, otp: string, driverId: string) {
  await assertDriverRide(rideId, driverId);
  const pax = await loadPax(rideId, paxId);
  // A passenger must be verified boarded before they can be verified dropped.
  // This matters most for logout rides now that boarding at the office is
  // its own verified step (mirrors login's home-pickup requirement).
  if (!pax.noShow && !pax.pickedAt) throw new ValidationError('Passenger has not boarded yet');
  await checkPaxOtpRateLimit(paxId);
  if (pax.dropOtp !== otp) throw new ValidationError('Incorrect drop OTP');
  await redis.del(`pax:otp:attempts:${paxId}`);
  await prisma.ridePax.update({ where: { id: paxId }, data: { droppedAt: new Date() } });
  await maybeComplete(rideId);
  return { ok: true };
}

// --- Stop arrival + no-show -------------------------------------------------
export const NO_SHOW_WAIT_MS = 5 * 60_000;   // wait this long at the stop first
export const ARRIVAL_RADIUS_M = 150;         // driver must be this close to confirm arrival
const GPS_MAX_AGE_MS = 3 * 60_000;           // the driver's last GPS fix must be this fresh

/**
 * When the driver may mark an employee no-show: 5 minutes after the LATER of
 * the driver's arrival at the stop and that employee's scheduled pickup time
 * (arriving early does not start the clock early). Without a usable scheduled
 * time (live rides) it is 5 minutes after arrival.
 */
export function noShowOpensAt(
  arrivedAt: Date | null,
  scheduledFor: Date | null,
  type: string | null,
  pickupHHMM: string | null,
): Date | null {
  if (!arrivedAt) return null;
  const sched = scheduledFor && /^\d{2}:\d{2}$/.test(pickupHHMM ?? '')
    ? firstPickupAt(scheduledFor, type, pickupHHMM)
    : null;
  const base = sched && sched.getTime() > arrivedAt.getTime() ? sched : arrivedAt;
  return new Date(base.getTime() + NO_SHOW_WAIT_MS);
}

/** "KA 05-NM 5271" -> "KA05NM5271" */
const normPlate = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Throws unless the driver's latest GPS fix is fresh and within the radius of (lat,lng). */
async function assertDriverAt(driverId: string, lat: number, lng: number): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ d: number | null; updated: Date | null }>>`
    SELECT ST_Distance(current_location, ST_Point(${lng}, ${lat})::geography)::float8 AS d,
           location_updated_at AS updated
    FROM drivers WHERE id = ${driverId}
  `;
  const r = rows[0];
  if (!r || r.d == null || !r.updated || Date.now() - new Date(r.updated).getTime() > GPS_MAX_AGE_MS) {
    throw new ValidationError("We can't see your location right now. Check GPS is on, then try again.");
  }
  if (r.d > ARRIVAL_RADIUS_M) {
    throw new ValidationError(
      `You are about ${Math.round(r.d)} m from the pickup point. Get within ${ARRIVAL_RADIUS_M} m to confirm arrival.`,
    );
  }
}

/**
 * The driver confirms arrival at a stop (must be within ARRIVAL_RADIUS_M).
 *  - logout ride: the stop is the office; every employee still to board is stamped.
 *  - login ride: the stop is that employee's home (`paxId`, or the next one still
 *    to be picked up when omitted).
 * Idempotent: an existing arrival time is never overwritten. Rides without
 * passenger rows (airport, legacy) are not geofenced.
 */
export async function confirmStopArrival(rideId: string, driverId: string, paxId?: string): Promise<void> {
  const ride = await assertDriverRide(rideId, driverId);
  if (!['assigned', 'in_progress'].includes(ride.status)) throw new ValidationError('Ride is not active');
  const pending = await prisma.ridePax.findMany({
    where: { rideId, pickedAt: null, noShow: false },
    orderBy: { seq: 'asc' },
    select: { id: true, employeeId: true },
  });
  if (pending.length === 0) return;
  let ids: string[];
  let lat: number;
  let lng: number;
  if (ride.type === 'logout') {
    const rows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(pickup_point::geometry) AS lat, ST_X(pickup_point::geometry) AS lng FROM rides WHERE id = ${rideId}
    `;
    if (!rows[0]) return;
    ({ lat, lng } = rows[0]);
    ids = pending.map((p) => p.id);
  } else {
    const target = paxId ? pending.find((p) => p.id === paxId) : pending[0];
    if (!target) return;
    const rows = await prisma.$queryRaw<Array<{ lat: number; lng: number }>>`
      SELECT ST_Y(pickup_location::geometry) AS lat, ST_X(pickup_location::geometry) AS lng
      FROM employees WHERE id = ${target.employeeId}
    `;
    if (!rows[0]) return;
    ({ lat, lng } = rows[0]);
    ids = [target.id];
  }
  await assertDriverAt(driverId, lat, lng);
  await prisma.ridePax.updateMany({ where: { id: { in: ids }, arrivedAt: null }, data: { arrivedAt: new Date() } });
}

/**
 * Mark an employee no-show. Instead of an OTP the driver types their own
 * vehicle number, and only after confirming arrival at this stop and waiting
 * out the 5 minutes (see noShowOpensAt).
 */
export async function markNoShow(rideId: string, paxId: string, driverId: string, vehicleNo: string) {
  const ride = await assertDriverRide(rideId, driverId);
  if (!['assigned', 'in_progress'].includes(ride.status)) throw new ValidationError('Ride is not active');
  const pax = await loadPax(rideId, paxId);
  if (pax.noShow) return { ok: true };
  if (pax.pickedAt) throw new ValidationError('This passenger has already boarded');
  if (!pax.arrivedAt) throw new ValidationError('Confirm your arrival at this stop first');
  const opens = noShowOpensAt(pax.arrivedAt, ride.scheduledFor, ride.type, pax.scheduledPickupTime);
  if (opens && Date.now() < opens.getTime()) {
    const s = Math.ceil((opens.getTime() - Date.now()) / 1000);
    throw new ValidationError(`No-show opens in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}. Keep waiting for the passenger.`);
  }
  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { vehicle: { select: { regNo: true } } },
  });
  const plate = driver?.vehicle?.regNo;
  if (!plate) throw new ValidationError('No vehicle is registered on your account');
  // Same attempt cap as OTP entry: max 5 tries per passenger per hour.
  const key = `pax:noshow:attempts:${paxId}`;
  const attempts = await redis.incr(key);
  if (attempts === 1) await redis.expire(key, 3600);
  if (attempts > 5) throw new TooManyRequestsError('Too many attempts. Try again later.');
  if (normPlate(vehicleNo) !== normPlate(plate)) throw new ValidationError('That is not your vehicle number');
  await redis.del(key);
  await prisma.ridePax.update({ where: { id: paxId }, data: { noShow: true, noShowAt: new Date() } });
  logger.info({ rideId, paxId, driverId }, 'Passenger marked no-show');
  await maybeComplete(rideId);
  return { ok: true };
}
