import { prisma } from '../lib/prisma';
import { NotFoundError } from '../types';

export interface CreatePayoutInput {
  vendorId: string;
  period: string;        // YYYY-MM
  amount?: number;       // optional flat amount (legacy)
  ratePerRide?: number;  // preferred: per-ride rate — amount auto-derives from completed rides
  fileUrl?: string;      // optional uploaded invoice/proof
}

// Count a vendor's completed rides, optionally scoped to a YYYY-MM period.
export async function countCompletedRides(vendorId: string, period?: string): Promise<number> {
  const where: Record<string, unknown> = { vendorId, status: 'completed' };
  if (period && /^\d{4}-\d{2}$/.test(period)) {
    const [y, m] = period.split('-').map(Number);
    where.completedAt = { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
  }
  return prisma.ride.count({ where });
}

export async function createPayout(input: CreatePayoutInput) {
  let amount = input.amount ?? 0;
  // When a per-ride rate is given, compute the amount from that period's completed rides.
  if (input.ratePerRide != null) {
    const rides = await countCompletedRides(input.vendorId, input.period);
    amount = input.ratePerRide * rides;
  }
  return prisma.payout.create({
    data: {
      vendorId: input.vendorId,
      period: input.period,
      amount,
      ratePerRide: input.ratePerRide ?? null,
      fileUrl: input.fileUrl ?? null,
    },
    include: { vendor: { select: { name: true } } },
  });
}

export async function listPayouts(filters: {
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

  const [payouts, total] = await Promise.all([
    prisma.payout.findMany({
      where,
      skip,
      take: limit,
      include: { vendor: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payout.count({ where }),
  ]);

  // Pending, rate-based payouts recalc live so newer rides in the same month are captured.
  const enriched = await Promise.all(
    payouts.map(async (p) => {
      if (p.status === 'pending' && p.ratePerRide != null) {
        const rides = await countCompletedRides(p.vendorId, p.period);
        return { ...p, rideCount: rides, amount: p.ratePerRide * rides };
      }
      return p;
    }),
  );

  return { payouts: enriched, total, page, limit };
}

// Admin manually attaches an invoice/proof file to an existing payout.
export async function attachPayoutFile(id: string, fileUrl: string) {
  const payout = await prisma.payout.findUnique({ where: { id } });
  if (!payout) throw new NotFoundError('Payout not found');
  return prisma.payout.update({
    where: { id },
    data: { fileUrl },
    include: { vendor: { select: { name: true } } },
  });
}

export async function markPayoutPaid(id: string) {
  const payout = await prisma.payout.findUnique({ where: { id } });
  if (!payout) throw new NotFoundError('Payout not found');

  // Freeze the live-computed amount at payout time for rate-based payouts.
  let amount = payout.amount;
  if (payout.ratePerRide != null) {
    const rides = await countCompletedRides(payout.vendorId, payout.period);
    amount = payout.ratePerRide * rides;
  }

  return prisma.payout.update({
    where: { id },
    data: { status: 'paid', paidAt: new Date(), amount },
    include: { vendor: { select: { name: true } } },
  });
}
