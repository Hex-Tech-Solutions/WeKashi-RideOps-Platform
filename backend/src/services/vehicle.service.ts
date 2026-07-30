import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { NotFoundError, ForbiddenError } from '../types';

export interface CreateVehicleInput {
  vendorId: string;
  regNo: string;
  capacity: number;
  fuelType: string;
  documents?: Record<string, unknown>;
}

export async function createVehicle(input: CreateVehicleInput) {
  return prisma.vehicle.create({
    data: {
      vendorId: input.vendorId,
      regNo: input.regNo,
      capacity: input.capacity,
      fuelType: input.fuelType,
      documents: (input.documents ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function listVehicles(vendorId: string, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [vehicles, total] = await Promise.all([
    prisma.vehicle.findMany({
      where: { vendorId },
      skip,
      take: limit,
      include: { drivers: { select: { id: true, fullName: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.vehicle.count({ where: { vendorId } }),
  ]);
  return { vehicles, total, page, limit };
}

export async function getVehicle(id: string, vendorId?: string) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    include: { drivers: { select: { id: true, fullName: true, status: true } } },
  });
  if (!vehicle) throw new NotFoundError('Vehicle not found');
  if (vendorId && vehicle.vendorId !== vendorId) {
    throw new ForbiddenError('Access denied');
  }
  return vehicle;
}

export async function updateVehicle(
  id: string,
  vendorId: string,
  data: Partial<CreateVehicleInput>,
) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle) throw new NotFoundError('Vehicle not found');
  if (vehicle.vendorId !== vendorId) throw new ForbiddenError('Access denied');

  return prisma.vehicle.update({
    where: { id },
    data: {
      capacity: data.capacity,
      fuelType: data.fuelType,
      documents: data.documents as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function deleteVehicle(id: string, vendorId: string) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id } });
  if (!vehicle) throw new NotFoundError('Vehicle not found');
  if (vehicle.vendorId !== vendorId) throw new ForbiddenError('Access denied');
  await prisma.vehicle.delete({ where: { id } });
}
