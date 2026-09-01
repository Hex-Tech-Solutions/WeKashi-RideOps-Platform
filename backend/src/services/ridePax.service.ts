import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { NotFoundError, ForbiddenError, ValidationError, TooManyRequestsError } from '../types';
import { smsSender } from '../lib/sms';
import { logger } from '../lib/logger';
import { randomInt } from 'crypto';

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
export async function sendPaxOtpSms(rideId: string): Promise<void> {
  try {
    const paxList = await prisma.ridePax.findMany({
      where: { rideId },
      include: { employee: { select: { name: true, phone: true } } },
    });
    for (const p of paxList) {
      if (!p.employee.phone) continue;
      try {
        await smsSender.send(
          p.employee.phone,
          `RideOps: Hi ${p.employee.name}, your cab has been assigned. Boarding OTP: ${p.pickupOtp} | Drop OTP: ${p.dropOtp}. Show these to your driver.`,
        );
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
      type: true, escortRequired: true, escortName: true,
      escortOtp: true, escortDroppedAt: true,
    },
  });
  if (!ride) throw new NotFoundError('Ride not found');

  const rows = await prisma.$queryRaw<Array<{
    id: string; seq: number; name: string; gender: string | null; emp_phone: string | null; sup_phone: string | null;
    pickup_otp: string; drop_otp: string; scheduled_pickup_time: string | null;
    picked_at: Date | null; dropped_at: Date | null; no_show: boolean; lat: number; lng: number;
  }>>`
    SELECT rp.id, rp.seq, e.name, e.gender, e.phone as emp_phone, u.phone as sup_phone,
      rp.pickup_otp, rp.drop_otp, rp.scheduled_pickup_time, rp.picked_at, rp.dropped_at, rp.no_show,
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
    select: { type: true, status: true, escortRequired: true },
  });
  if (!ride || ride.type !== 'logout') return;
  if (!['assigned', 'in_progress'].includes(ride.status)) return;

  // Atomic: only complete if NO undropped, non-noshow passengers remain,
  // AND (no escort required OR the escort has been verified dropped).
  await prisma.$executeRaw`
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

export async function markNoShow(rideId: string, paxId: string, driverId: string) {
  await assertDriverRide(rideId, driverId);
  await loadPax(rideId, paxId);
  await prisma.ridePax.update({ where: { id: paxId }, data: { noShow: true } });
  await maybeComplete(rideId);
  return { ok: true };
}
