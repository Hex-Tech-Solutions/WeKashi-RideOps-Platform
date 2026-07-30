import { prisma } from '../lib/prisma';

export async function getOverview() {
  const [
    totalRides,
    activeDrivers,
    totalVendors,
    revenueAgg,
    ridesByStatus,
  ] = await Promise.all([
    prisma.ride.count(),
    prisma.driver.count({ where: { isOnline: true, status: 'active' } }),
    prisma.vendor.count(),
    prisma.ride.aggregate({
      where: { status: 'completed' },
      _sum: { price: true },
    }),
    prisma.ride.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ]);

  return {
    totalRides,
    activeDrivers,
    totalVendors,
    totalRevenue: revenueAgg._sum.price ?? 0,
    ridesByStatus: Object.fromEntries(
      ridesByStatus.map((r) => [r.status, r._count._all]),
    ),
  };
}

export async function getRideAnalytics(period?: string) {
  const where: Record<string, unknown> = {};
  if (period) {
    // period format: "2024-01" → filter by month
    const [year, month] = period.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    where.createdAt = { gte: start, lt: end };
  }

  const byStatus = await prisma.ride.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  });

  const byType = await prisma.ride.groupBy({
    by: ['type'],
    where,
    _count: { _all: true },
  });

  const revenueAgg = await prisma.ride.aggregate({
    where: { ...where, status: 'completed' },
    _sum: { price: true },
    _avg: { price: true },
    _count: { _all: true },
  });

  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
    byType: Object.fromEntries(byType.map((r) => [r.type, r._count._all])),
    totalRevenue: revenueAgg._sum.price ?? 0,
    averagePrice: revenueAgg._avg.price ?? 0,
    completedCount: revenueAgg._count._all,
  };
}

export async function getVendorPerformance(vendorId: string) {
  const [
    drivers,
    rides,
    revenueAgg,
    ratingAgg,
  ] = await Promise.all([
    prisma.driver.groupBy({
      by: ['status'],
      where: { vendorId },
      _count: { _all: true },
    }),
    prisma.ride.groupBy({
      by: ['status'],
      where: { vendorId },
      _count: { _all: true },
    }),
    prisma.ride.aggregate({
      where: { vendorId, status: 'completed' },
      _sum: { price: true },
    }),
    prisma.driver.aggregate({
      where: { vendorId },
      _avg: { rating: true },
    }),
  ]);

  return {
    vendorId,
    driversByStatus: Object.fromEntries(drivers.map((d) => [d.status, d._count._all])),
    ridesByStatus: Object.fromEntries(rides.map((r) => [r.status, r._count._all])),
    totalRevenue: revenueAgg._sum.price ?? 0,
    averageDriverRating: ratingAgg._avg.rating ?? 0,
  };
}
