import { prisma } from '../lib/prisma';
import { NotFoundError } from '../types';

export interface CreateIncidentInput {
  rideId: string;
  reportedBy: string;
  description: string;
}

export async function createIncident(input: CreateIncidentInput) {
  return prisma.safetyIncident.create({ data: input });
}

export async function listIncidents(filters: {
  rideId?: string;
  status?: string;
  page?: number;
  limit?: number;
}) {
  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (filters.rideId) where.rideId = filters.rideId;
  if (filters.status) where.status = filters.status;

  const [incidents, total] = await Promise.all([
    prisma.safetyIncident.findMany({
      where,
      skip,
      take: limit,
      include: { ride: { select: { id: true, status: true, supervisor: { select: { fullName: true } } } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.safetyIncident.count({ where }),
  ]);

  return { incidents, total, page, limit };
}

export async function updateIncidentStatus(id: string, status: string) {
  const incident = await prisma.safetyIncident.findUnique({ where: { id } });
  if (!incident) throw new NotFoundError('Incident not found');
  return prisma.safetyIncident.update({ where: { id }, data: { status } });
}
