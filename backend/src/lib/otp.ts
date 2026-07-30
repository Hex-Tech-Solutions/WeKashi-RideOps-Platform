import bcrypt from 'bcrypt';
import { redis } from './redis';
import { prisma } from './prisma';
import { TooManyRequestsError } from '../types';
import { logger } from './logger';

const OTP_BCRYPT_ROUNDS = 10;
const OTP_TTL_SECONDS = 600; // 10 minutes
const OTP_RATE_LIMIT_MAX = 5;
const OTP_RATE_LIMIT_WINDOW = 600; // 10 minutes

/**
 * Generate a 6-digit OTP string
 */
export function generateOtp(): string {
  const num = Math.floor(100000 + Math.random() * 900000);
  return num.toString();
}

/**
 * Rate-limit OTP requests per phone (5 per 10 minutes).
 * Throws TooManyRequestsError if exceeded.
 */
export async function checkOtpRateLimit(phone: string): Promise<void> {
  const key = `otp:ratelimit:${phone}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, OTP_RATE_LIMIT_WINDOW);
  }
  if (count > OTP_RATE_LIMIT_MAX) {
    throw new TooManyRequestsError(
      'OTP request limit exceeded. Try again in 10 minutes.',
    );
  }
}

/**
 * Store hashed OTP in DB with expiry.
 */
export async function storeOtp(phone: string, otp: string): Promise<void> {
  const otpHash = await bcrypt.hash(otp, OTP_BCRYPT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

  await prisma.driverOtp.upsert({
    where: { phone },
    create: { phone, otpHash, expiresAt, attemptCount: 0 },
    update: { otpHash, expiresAt, attemptCount: 0 },
  });
}

/**
 * Verify OTP for a phone number.
 * Increments attempt count. Deletes on success.
 * Returns true on success, false on mismatch, throws on max attempts.
 */
export async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  // OTP bypass — enabled whenever DEV_OTP_BYPASS is set (explicit opt-in).
  // Unset DEV_OTP_BYPASS in .env.prod to require real SMS OTPs in production.
  if (process.env.DEV_OTP_BYPASS && otp === process.env.DEV_OTP_BYPASS) {
    logger.debug({ phone }, 'OTP bypass used');
    return true;
  }

  const record = await prisma.driverOtp.findUnique({ where: { phone } });
  if (!record) {
    return false;
  }

  // Check expiry
  if (record.expiresAt < new Date()) {
    await prisma.driverOtp.delete({ where: { phone } });
    return false;
  }

  // Check max verify attempts via Redis
  const attemptsKey = `otp:attempts:${phone}`;
  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) {
    await redis.expire(attemptsKey, OTP_TTL_SECONDS);
  }
  if (attempts > OTP_RATE_LIMIT_MAX) {
    throw new TooManyRequestsError('Too many OTP verification attempts');
  }

  const valid = await bcrypt.compare(otp, record.otpHash);
  if (valid) {
    await prisma.driverOtp.delete({ where: { phone } });
    await redis.del(attemptsKey);
    return true;
  }

  return false;
}
