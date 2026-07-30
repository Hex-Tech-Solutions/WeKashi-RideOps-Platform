import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { NotFoundError, ConflictError } from '../types';

/**
 * Generate a unique vendor code in the format VND-XXXXXX.
 * Shared with admin.service — kept local to avoid circular imports.
 */
async function generateVendorCode(): Promise<string> {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 5; attempt++) {
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += CHARS[Math.floor(Math.random() * CHARS.length)];
    const code = `VND-${suffix}`;
    const existing = await prisma.vendor.findUnique({ where: { vendorCode: code } });
    if (!existing) return code;
  }
  return `VND-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

export interface CreateVendorInput {
  name: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  payoutDetails?: Record<string, unknown>;
  userId: string;
}

export async function createVendor(input: CreateVendorInput) {
  const existing = await prisma.vendor.findUnique({ where: { userId: input.userId } });
  if (existing) throw new ConflictError('User already has a vendor account');

  return prisma.vendor.create({
    data: {
      name: input.name,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      payoutDetails: input.payoutDetails as Prisma.InputJsonValue | undefined,
      vendorCode: await generateVendorCode(),
      userId: input.userId,
    },
  });
}

export async function listVendors(page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [vendors, total] = await Promise.all([
    prisma.vendor.findMany({
      skip,
      take: limit,
      include: { user: { select: { email: true, isActive: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.vendor.count(),
  ]);
  return { vendors, total, page, limit };
}

export async function getVendor(id: string) {
  const vendor = await prisma.vendor.findUnique({
    where: { id },
    include: {
      user: { select: { email: true, fullName: true } },
      _count: { select: { drivers: true, vehicles: true, rides: true } },
    },
  });
  if (!vendor) throw new NotFoundError('Vendor not found');
  return vendor;
}

export async function updateVendor(id: string, data: Partial<CreateVendorInput>) {
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) throw new NotFoundError('Vendor not found');

  return prisma.vendor.update({
    where: { id },
    data: {
      name: data.name,
      contactName: data.contactName,
      contactPhone: data.contactPhone,
      contactEmail: data.contactEmail,
      payoutDetails: data.payoutDetails as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function deleteVendor(id: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) throw new NotFoundError('Vendor not found');
  await prisma.vendor.delete({ where: { id } });
}

export async function getVendorStats(vendorId: string) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new NotFoundError('Vendor not found');

  const [
    totalDrivers,
    activeDrivers,
    totalRides,
    completedRides,
    totalRevenue,
    pendingPayouts,
  ] = await Promise.all([
    prisma.driver.count({ where: { vendorId } }),
    prisma.driver.count({ where: { vendorId, status: 'active' } }),
    prisma.ride.count({ where: { vendorId } }),
    prisma.ride.count({ where: { vendorId, status: 'completed' } }),
    prisma.ride.aggregate({
      where: { vendorId, status: 'completed' },
      _sum: { price: true },
    }),
    prisma.payout.aggregate({
      where: { vendorId, status: 'pending' },
      _sum: { amount: true },
    }),
  ]);

  return {
    vendorId,
    vendorName: vendor.name,
    totalDrivers,
    activeDrivers,
    totalRides,
    completedRides,
    totalRevenue: totalRevenue._sum.price ?? 0,
    pendingPayoutAmount: pendingPayouts._sum.amount ?? 0,
  };
}
