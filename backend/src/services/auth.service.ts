import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../lib/jwt';
import {
  UnauthorizedError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from '../types';
import { logger } from '../lib/logger';

const BCRYPT_ROUNDS = 12;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export interface RegisterInput {
  email: string;
  password: string;
  role: 'admin' | 'supervisor' | 'vendor';
  fullName: string;
  org?: string;
  inviteToken?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export async function registerUser(input: RegisterInput): Promise<TokenPair> {
  // Validate admin invite
  if (input.role === 'admin') {
    const expectedToken = process.env.ADMIN_INVITE_TOKEN;
    if (!expectedToken || input.inviteToken !== expectedToken) {
      throw new ValidationError('Invalid or missing admin invite token');
    }
  }

  // Check for duplicate email
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError('Email already registered');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash,
      role: input.role,
      fullName: input.fullName,
      org: input.org,
    },
  });

  logger.info({ userId: user.id, role: user.role }, 'User registered');
  return issueTokenPair(user.id, user.role);
}

export async function loginUser(
  email: string,
  password: string,
): Promise<TokenPair & { user: { id: string; role: string; fullName: string } }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Invalid credentials');
  }

  logger.info({ userId: user.id }, 'User logged in');
  const tokens = await issueTokenPair(user.id, user.role);
  return { ...tokens, user: { id: user.id, role: user.role, fullName: user.fullName } };
}

export async function refreshTokens(rawRefreshToken: string): Promise<TokenPair> {
  const payload = verifyRefreshToken(rawRefreshToken);
  const tokenHash = hashToken(rawRefreshToken);

  const stored = await prisma.refreshToken.findFirst({
    where: { tokenHash, revokedAt: null },
  });

  if (!stored || stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  // Atomic rotation: revoke old, issue new
  const newTokens = await prisma.$transaction(async (tx) => {
    await tx.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const { token, expiresAt } = signRefreshToken(payload.sub, payload.role);
    const newHash = hashToken(token);

    await tx.refreshToken.create({
      data: {
        userId: stored.userId,
        driverId: stored.driverId,
        tokenHash: newHash,
        expiresAt,
      },
    });

    const accessToken = signAccessToken({ sub: payload.sub, role: payload.role });
    return { accessToken, refreshToken: token };
  });

  return newTokens;
}

export async function logout(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function issueTokenPair(
  sub: string,
  role: 'admin' | 'supervisor' | 'vendor',
): Promise<TokenPair> {
  const accessToken = signAccessToken({ sub, role });
  const { token: refreshToken, expiresAt } = signRefreshToken(sub, role);
  const tokenHash = hashToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: sub,
      tokenHash,
      expiresAt,
    },
  });

  return { accessToken, refreshToken };
}

// ─── Driver Auth ────────────────────────────────────────────────────────────

export async function loginDriverWithOtp(
  phone: string,
): Promise<TokenPair & { driver: { id: string; fullName: string; vendorId: string; status: string } }> {
  const driver = await prisma.driver.findUnique({ where: { phone } });
  if (!driver) {
    throw new NotFoundError('No account found for this number. Please register first.');
  }
  // Allow pending drivers to log in so they can upload KYC docs.
  // Only block blacklisted or expired accounts.
  if (driver.status === 'blacklisted' || driver.status === 'expired') {
    throw new UnauthorizedError('Driver account is suspended. Contact your vendor.');
  }

  const accessToken = signAccessToken({
    sub: driver.id,
    role: 'driver',
    vendorId: driver.vendorId,
  });
  const { token: refreshToken, expiresAt } = signRefreshToken(driver.id, 'driver');
  const tokenHash = hashToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      driverId: driver.id,
      tokenHash,
      expiresAt,
    },
  });

  logger.info({ driverId: driver.id }, 'Driver logged in');

  return {
    accessToken,
    refreshToken,
    driver: { id: driver.id, fullName: driver.fullName, vendorId: driver.vendorId, status: driver.status },
  };
}
