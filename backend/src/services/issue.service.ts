import { prisma } from '../lib/prisma';
import { NotFoundError, ForbiddenError, ValidationError } from '../types';

// ─── Access control ───────────────────────────────────────────────────────────

/**
 * The issue's supervisor, the issue's vendor, admin, and the issue's own driver
 * (for SOS chat) can view/chat on an issue.
 */
export async function assertCanAccessIssue(
  issueId: string,
  user: { id: string; role: string },
) {
  const issue = await prisma.driverIssue.findUnique({ where: { id: issueId } });
  if (!issue) throw new NotFoundError('Issue not found');
  if (user.role === 'admin') return issue;
  if (user.role === 'supervisor' && issue.supervisorId === user.id) return issue;
  if (user.role === 'driver'    && issue.driverId    === user.id) return issue;
  if (user.role === 'vendor') {
    const vendor = await prisma.vendor.findUnique({ where: { id: issue.vendorId } });
    if (vendor?.userId === user.id) return issue;
  }
  throw new ForbiddenError('Access denied');
}

// ─── Messages ─────────────────────────────────────────────────────────────────

export async function getIssueMessages(issueId: string) {
  return prisma.issueMessage.findMany({
    where: { issueId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function addIssueMessage(
  issueId: string,
  sender: { id: string; role: string },
  body: string,
) {
  // Resolve the sender's display name regardless of whether they are a user or driver.
  let senderName = sender.role;
  if (sender.role === 'driver') {
    const driver = await prisma.driver.findUnique({
      where: { id: sender.id },
      select: { fullName: true },
    });
    senderName = driver?.fullName ?? 'Driver';
  } else {
    const user = await prisma.user.findUnique({
      where: { id: sender.id },
      select: { fullName: true },
    });
    senderName = user?.fullName ?? sender.role;
  }

  return prisma.issueMessage.create({
    data: {
      issueId,
      senderId: sender.id,
      senderRole: sender.role,
      senderName,
      body,
    },
  });
}

// ─── Create issue (supervisor) ────────────────────────────────────────────────

export async function createIssue(input: {
  supervisorId: string;
  rideId: string;
  description: string;
}) {
  const ride = await prisma.ride.findUnique({ where: { id: input.rideId } });
  if (!ride) throw new NotFoundError('Ride not found');
  if (ride.supervisorId !== input.supervisorId) throw new ForbiddenError('Not your ride');
  if (!ride.driverId) throw new ValidationError('This ride has no driver to raise an issue against');

  const driver = await prisma.driver.findUnique({ where: { id: ride.driverId } });
  const vendorId = ride.vendorId ?? driver?.vendorId;
  if (!vendorId) throw new ValidationError('Could not resolve the driver vendor');

  return prisma.driverIssue.create({
    data: {
      supervisorId: input.supervisorId,
      driverId: ride.driverId,
      vendorId,
      rideId: ride.id,
      description: input.description,
      isSos: false,
    },
    include: includeShape,
  });
}

// ─── Create SOS (driver) ──────────────────────────────────────────────────────

export type SosIssueType = 'vehicle_issue' | 'medical_emergency' | 'other';

export async function createDriverSos(input: {
  driverId: string;
  issueType: SosIssueType;
  description: string;
  rideId?: string;
}): Promise<{
  issue: Awaited<ReturnType<typeof prisma.driverIssue.create>>;
  supervisorId: string;
}> {
  // Resolve supervisor: prefer the active ride's supervisor, else fall back to
  // the most recent ride this driver has been on.
  let rideId = input.rideId;
  let supervisorId: string | null = null;
  let vendorId: string | null = null;

  if (rideId) {
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (ride) {
      supervisorId = ride.supervisorId;
      vendorId = ride.vendorId;
    }
  }

  if (!supervisorId) {
    // Fall back: most recent assigned/in_progress ride for this driver
    const latest = await prisma.ride.findFirst({
      where: {
        driverId: input.driverId,
        status: { in: ['assigned', 'in_progress'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) {
      supervisorId = latest.supervisorId;
      vendorId = latest.vendorId;
      rideId = latest.id;
    }
  }

  if (!supervisorId) {
    // Last resort: any ride this driver has ever had
    const anyRide = await prisma.ride.findFirst({
      where: { driverId: input.driverId },
      orderBy: { createdAt: 'desc' },
    });
    supervisorId = anyRide?.supervisorId ?? null;
    vendorId = anyRide?.vendorId ?? null;
    if (anyRide && !rideId) rideId = anyRide.id;
  }

  if (!supervisorId) {
    throw new ValidationError(
      'Could not find an associated supervisor. Please contact your vendor directly.',
    );
  }

  // Resolve vendorId from driver if still missing
  if (!vendorId) {
    const driver = await prisma.driver.findUnique({ where: { id: input.driverId } });
    vendorId = driver?.vendorId ?? null;
  }
  if (!vendorId) throw new ValidationError('Could not resolve vendor for this driver');

  const issue = await prisma.driverIssue.create({
    data: {
      supervisorId,
      driverId: input.driverId,
      vendorId,
      rideId: rideId ?? null,
      description: input.description,
      issueType: input.issueType,
      isSos: true,
    },
    include: includeShape,
  });

  return { issue, supervisorId };
}

// ─── List / status ────────────────────────────────────────────────────────────

const includeShape = {
  driver:     { select: { fullName: true, phone: true } },
  supervisor: { select: { fullName: true, org: true, phone: true } },
  vendor:     { select: { name: true } },
  ride: {
    select: {
      pickupAddress: true,
      dropAddress: true,
      type: true,
      price: true,
      distanceKm: true,
      createdAt: true,
      driverId: true,
    },
  },
} as const;

export async function listIssues(filters: {
  role: string;
  userId?: string;
  vendorId?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters.role === 'supervisor') where.supervisorId = filters.userId;
  else if (filters.role === 'vendor') where.vendorId = filters.vendorId;
  // admin: all

  return prisma.driverIssue.findMany({
    where,
    include: includeShape,
    orderBy: [{ isSos: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function setIssueStatus(id: string, status: 'open' | 'resolved') {
  const issue = await prisma.driverIssue.findUnique({ where: { id } });
  if (!issue) throw new NotFoundError('Issue not found');
  return prisma.driverIssue.update({
    where: { id },
    data: { status },
    include: includeShape,
  });
}
