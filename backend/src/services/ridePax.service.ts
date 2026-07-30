import { prisma } from '../lib/prisma';
import { NotFoundError, ForbiddenError, ValidationError } from '../types';
import { smsSender } from '../lib/sms';
import { logger } from '../lib/logger';

const gen4 = () => String(Math.floor(1000 + Math.random() * 9000));

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
          `RideOps: Hi ${p.employee.name}, your cab has been assigned. Pickup OTP: ${p.pickupOtp} | Drop OTP: ${p.dropOtp}. Show these to your driver.`,
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

// Ordered pax with the stop coordinates relevant to the ride type
// (login → home pickup; logout → home drop). OTPs only for supervisor/admin.
export async function getRidePax(rideId: string, opts: { includeOtp: boolean }) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId }, select: { type: true } });
  if (!ride) throw new NotFoundError('Ride not found');
  const isLogout = ride.type === 'logout';

  const rows = await prisma.$queryRaw<Array<{
    id: string; seq: number; name: string; gender: string | null; emp_phone: string | null; sup_phone: string | null;
    pickup_otp: string; drop_otp: string; scheduled_pickup_time: string | null;
    picked_at: Date | null; dropped_at: Date | null; no_show: boolean; lat: number; lng: number;
  }>>`
    SELECT rp.id, rp.seq, e.name, e.gender, e.phone as emp_phone, u.phone as sup_phone,
      rp.pickup_otp, rp.drop_otp, rp.scheduled_pickup_time, rp.picked_at, rp.dropped_at, rp.no_show,
      ST_Y((CASE WHEN ${isLogout} THEN e.drop_location ELSE e.pickup_location END)::geometry) as lat,
      ST_X((CASE WHEN ${isLogout} THEN e.drop_location ELSE e.pickup_location END)::geometry) as lng
    FROM ride_pax rp
    JOIN employees e ON e.id = rp.employee_id
    JOIN rides r ON r.id = rp.ride_id
    JOIN users u ON u.id = r.supervisor_id
    WHERE rp.ride_id = ${rideId}
    ORDER BY rp.seq
  `;

  return {
    type: ride.type,
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

// Auto-complete the ride once every passenger is dropped (logout only).
// Login rides still have to reach the office after the last pickup, so those are
// completed manually by the driver — never auto-completed on the final pickup.
async function maybeComplete(rideId: string): Promise<void> {
  const ride = await prisma.ride.findUnique({ where: { id: rideId }, select: { type: true, status: true } });
  if (!ride || ride.type !== 'logout') return;
  if (!['assigned', 'in_progress'].includes(ride.status)) return;
  const pax = await prisma.ridePax.findMany({ where: { rideId } });
  if (!pax.length) return;
  const allDone = pax.every((p) => p.noShow || p.droppedAt);
  if (allDone) {
    await prisma.ride.update({ where: { id: rideId }, data: { status: 'completed', completedAt: new Date() } });
  }
}

export async function verifyPickup(rideId: string, paxId: string, otp: string, driverId: string) {
  await assertDriverRide(rideId, driverId);
  const pax = await loadPax(rideId, paxId);
  if (pax.pickupOtp !== otp) throw new ValidationError('Incorrect pickup OTP');
  await prisma.ridePax.update({ where: { id: paxId }, data: { pickedAt: new Date(), noShow: false } });
  await maybeComplete(rideId);
  return { ok: true };
}

export async function verifyDrop(rideId: string, paxId: string, otp: string, driverId: string) {
  await assertDriverRide(rideId, driverId);
  const pax = await loadPax(rideId, paxId);
  if (pax.dropOtp !== otp) throw new ValidationError('Incorrect drop OTP');
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
