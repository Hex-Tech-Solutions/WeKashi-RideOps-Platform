/**
 * Driver "Recent trips" (#16): completed rides + rentals in an IST period,
 * with two totals (trips, earnings). Cancelled rides are not listed and not
 * counted.
 *
 * Periods (IST calendar days, today = day 0):
 *   today  — today
 *   last7  — the last 7 days including today (days 0–6)
 *   prev7  — the 7 days before that (days 7–13), shown as "8–14 days ago"
 *
 * Earnings use the same rule as the earnings card (getDriverStats): ride
 * price + escort charge; rentals use their final total.
 */
import { prisma } from '../lib/prisma';

export type TripRange = 'today' | 'last7' | 'prev7';
export const TRIP_RANGES: readonly TripRange[] = ['today', 'last7', 'prev7'];

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC instant of IST midnight `daysAgo` days before today. */
function istMidnight(now: Date, daysAgo: number): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const midnightIst = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - daysAgo * DAY_MS;
  return new Date(midnightIst - IST_OFFSET_MS);
}

/** [from, to) in UTC for a period. Exported for unit tests. */
export function tripRangeBounds(range: TripRange, now = new Date()): { from: Date; to: Date } {
  if (range === 'today') return { from: istMidnight(now, 0), to: new Date(istMidnight(now, 0).getTime() + DAY_MS) };
  if (range === 'last7') return { from: istMidnight(now, 6), to: new Date(istMidnight(now, 0).getTime() + DAY_MS) };
  return { from: istMidnight(now, 13), to: istMidnight(now, 6) };
}

export async function listDriverTrips(driverId: string, range: TripRange) {
  const { from, to } = tripRangeBounds(range);

  const [rides, rentals] = await Promise.all([
    prisma.ride.findMany({
      where: {
        driverId,
        status: 'completed',
        // Older rows may lack completedAt — fall back to when they were created.
        OR: [
          { completedAt: { gte: from, lt: to } },
          { completedAt: null, createdAt: { gte: from, lt: to } },
        ],
      },
      select: {
        id: true, type: true, status: true, pickupAddress: true, dropAddress: true,
        price: true, escortCharge: true, completedAt: true, createdAt: true,
        paymentStatus: true, paymentRef: true, paidAt: true, paymentReceivedAt: true,
      },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    }),
    prisma.rental.findMany({
      where: { driverId, status: 'completed', completedAt: { gte: from, lt: to } },
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
      take: 200,
    }),
  ]);

  const rideEarnings = rides.reduce((s, r) => s + (r.price ?? 0) + (r.escortCharge ?? 0), 0);
  const rentalEarnings = rentals.reduce((s, r) => s + (r.totalAmount ?? r.basePrice + r.overageAmount), 0);

  return {
    range,
    from,
    to,
    rides,
    rentals,
    summary: {
      trips: rides.length + rentals.length,
      earnings: Math.round((rideEarnings + rentalEarnings) * 100) / 100,
    },
  };
}
