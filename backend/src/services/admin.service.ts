import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../types';
import { logger } from '../lib/logger';

const BCRYPT_ROUNDS = 12;

/**
 * Generate a unique vendor code in the format VND-XXXXXX
 * (6 uppercase alphanumeric characters, collision-retried up to 5 times).
 */
async function generateVendorCode(): Promise<string> {
  const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1 to avoid confusion
  for (let attempt = 0; attempt < 5; attempt++) {
    let suffix = '';
    for (let i = 0; i < 6; i++) suffix += CHARS[Math.floor(Math.random() * CHARS.length)];
    const code = `VND-${suffix}`;
    const existing = await prisma.vendor.findUnique({ where: { vendorCode: code } });
    if (!existing) return code;
  }
  // Extremely unlikely — fall back to timestamp-based code
  return `VND-${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

// A "tenant" = a company + its supervisor login. Only admins provision these.
export async function createTenant(input: {
  email: string;
  password: string;
  fullName: string;
  company: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('Email already registered');

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: 'supervisor',
      fullName: input.fullName,
      org: input.company,
    },
  });
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    org: user.org,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

export async function listTenants() {
  const users = await prisma.user.findMany({
    where: { role: 'supervisor' },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { employees: true, rides: true } } },
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    org: u.org,
    isActive: u.isActive,
    createdAt: u.createdAt,
    employeeCount: u._count.employees,
    rideCount: u._count.rides,
  }));
}

export async function setTenantActive(id: string, isActive: boolean) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== 'supervisor') throw new NotFoundError('Tenant not found');
  const updated = await prisma.user.update({
    where: { id },
    data: { isActive },
    select: { id: true, isActive: true },
  });
  return updated;
}

// Creates a vendor login + vendor record in one shot.
export async function createVendorAccount(input: {
  company: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  email: string;
  password: string;
}) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('Email already registered');

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        role: 'vendor',
        fullName: input.contactName,
        org: input.company,
      },
    });
    const vendor = await tx.vendor.create({
      data: {
        name: input.company,
        contactName: input.contactName,
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        vendorCode: await generateVendorCode(),
        userId: user.id,
      },
    });
    return { vendorId: vendor.id, userId: user.id, name: vendor.name, vendorCode: vendor.vendorCode };
  });
}

// ─── Registration Requests ───────────────────────────────────────────────────

export async function submitRegistrationRequest(input: {
  role: 'supervisor' | 'vendor';
  fullName: string;
  email: string;
  password: string;
  mobile: string;
  companyName: string;
  gstin?: string;
  address: string;
}) {
  // Check no existing user or pending request with same email
  const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
  if (existingUser) throw new ConflictError('An account with this email already exists');

  const existingRequest = await prisma.registrationRequest.findUnique({ where: { email: input.email } });
  if (existingRequest && existingRequest.status === 'pending') {
    throw new ConflictError('A registration request with this email is already pending review');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const req = await prisma.registrationRequest.create({
    data: {
      role: input.role,
      fullName: input.fullName,
      email: input.email,
      passwordHash,
      mobile: input.mobile,
      companyName: input.companyName,
      gstin: input.gstin ?? null,
      address: input.address,
      status: 'pending',
    },
  });
  logger.info({ id: req.id, role: req.role, email: req.email }, 'Registration request submitted');
  return { id: req.id, message: 'Request submitted. You will be notified once reviewed.' };
}

export async function listRegistrationRequests(status?: string) {
  return prisma.registrationRequest.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    // Never return passwordHash to the API layer
    select: {
      id: true, role: true, fullName: true, email: true,
      mobile: true, companyName: true, gstin: true, address: true,
      status: true, reviewNote: true, createdAt: true, reviewedAt: true,
    },
  });
}

export async function reviewRegistrationRequest(
  id: string,
  decision: 'approved' | 'rejected',
  reviewNote?: string,
) {
  const req = await prisma.registrationRequest.findUnique({ where: { id } });
  if (!req) throw new NotFoundError('Registration request not found');
  if (req.status !== 'pending') throw new ValidationError('Request has already been reviewed');

  await prisma.registrationRequest.update({
    where: { id },
    data: { status: decision, reviewNote: reviewNote ?? null, reviewedAt: new Date() },
  });

  if (decision === 'rejected') {
    logger.info({ id, email: req.email }, 'Registration request rejected');
    return { status: 'rejected' };
  }

  // Approved — create the actual account
  if (req.role === 'supervisor') {
    const existing = await prisma.user.findUnique({ where: { email: req.email } });
    if (!existing) {
      await prisma.user.create({
        data: {
          email: req.email,
          passwordHash: req.passwordHash,
          role: 'supervisor',
          fullName: req.fullName,
          phone: req.mobile,
          org: req.companyName,
        },
      });
    }
  } else if (req.role === 'vendor') {
    const existing = await prisma.user.findUnique({ where: { email: req.email } });
    if (!existing) {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: req.email,
            passwordHash: req.passwordHash,
            role: 'vendor',
            fullName: req.fullName,
            phone: req.mobile,
            org: req.companyName,
          },
        });
        await tx.vendor.create({
          data: {
            name: req.companyName,
            contactName: req.fullName,
            contactEmail: req.email,
            contactPhone: req.mobile,
            vendorCode: await generateVendorCode(),
            userId: user.id,
          },
        });
      });
    }
  }

  logger.info({ id, role: req.role, email: req.email }, 'Registration request approved — account created');
  return { status: 'approved', email: req.email };
}
