/**
 * Driver self sign-up = a REQUEST the vendor approves.
 *
 *  1. The driver submits name, phone, vehicle number and vendor code. No OTP is
 *     sent — nothing can be used to spam SMS. The account is created as
 *     'pending' (signupSource 'self') with its Vehicle row (reg no only).
 *  2. The vendor approves it on the Approvals page (status -> active), or
 *     rejects it (status -> 'rejected', which is NOT a blacklist).
 *  3. Only an ACTIVE account can request a sign-in OTP. That first OTP is what
 *     proves the person holds the phone.
 *
 * A pending request blocks duplicate requests for the same phone / vehicle,
 * but expires after SIGNUP_EXPIRY_DAYS if not approved, so a request made with
 * someone else's number can't hold it for long. Rejected and expired requests
 * release the phone and vehicle number so the person can apply again.
 */
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import {
  requireIndianMobile, requireIndianRegNo, assertNoIdentityConflict, assertRegNoAvailable,
  IDENTITY_CONFLICT_MESSAGE,
} from '../lib/identity';
import { ValidationError, ConflictError, NotFoundError, ForbiddenError, TooManyRequestsError } from '../types';

export const SIGNUP_EXPIRY_DAYS = 7;
const SUBMIT_LIMIT_PER_PHONE = 3;     // submissions per phone per hour
const SUBMIT_WINDOW_SEC = 60 * 60;

export interface SignupInput {
  fullName: string;
  phone: string;
  vehicleNo: string;
  vendorCode: string;
}

export async function submitSignupRequest(input: SignupInput): Promise<{ vendorName: string }> {
  const fullName = input.fullName.trim();
  if (fullName.length < 2) throw new ValidationError('Enter your full name');
  const phone = requireIndianMobile(input.phone);
  const regNo = requireIndianRegNo(input.vehicleNo);

  // Light per-phone limit so one number can't be submitted over and over.
  const key = `signup:submit:${phone}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, SUBMIT_WINDOW_SEC);
  if (count > SUBMIT_LIMIT_PER_PHONE) {
    throw new TooManyRequestsError('Too many sign-up attempts for this number. Try again in an hour.');
  }

  const vendor = await prisma.vendor.findUnique({
    where: { vendorCode: input.vendorCode.toUpperCase().trim() },
    select: { id: true, name: true },
  });
  if (!vendor) throw new ValidationError('Invalid vendor code. Check with your fleet manager.');

  // Clear any of this person's stale requests first, so an expired request
  // made with their number doesn't block them.
  await expireStaleSignups();

  await assertNoIdentityConflict({ phone }, undefined, 'self-register');
  await assertRegNoAvailable(regNo);

  try {
    await prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.create({ data: { vendorId: vendor.id, regNo } });
      await tx.driver.create({
        data: {
          phone,
          fullName,
          vendorId: vendor.id,
          vehicleId: vehicle.id,
          status: 'pending',
          kycStatus: 'pending',
          signupSource: 'self',
        },
      });
    });
  } catch (e: any) {
    if (e?.code === 'P2002') throw new ConflictError(IDENTITY_CONFLICT_MESSAGE);
    throw e;
  }

  logger.info({ vendorId: vendor.id }, 'Driver sign-up request submitted');
  return { vendorName: vendor.name };
}

/**
 * Close a sign-up request without blacklisting: the phone is renamed and the
 * vehicle row (created by the request) deleted, so both are free again.
 */
async function closeSignup(driverId: string, reason: 'rejected' | 'expired'): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const d = await tx.driver.findUnique({ where: { id: driverId } });
    if (!d || d.status !== 'pending') return;
    await tx.driver.update({
      where: { id: driverId },
      data: {
        status: 'rejected',
        removedAt: new Date(),
        phone: `${reason}:${driverId.slice(0, 8)}:${d.phone}`,
        vehicleId: null,
        isOnline: false,
        fcmToken: null,
      },
    });
    if (d.vehicleId) {
      const stillUsed = await tx.driver.count({ where: { vehicleId: d.vehicleId } });
      if (stillUsed === 0) await tx.vehicle.delete({ where: { id: d.vehicleId } });
    }
  });
}

/** Vendor (own drivers) or admin rejects a pending sign-up. Not a blacklist. */
export async function rejectSignup(
  driverId: string,
  actor: { role: 'vendor' | 'admin'; vendorId?: string },
): Promise<void> {
  const d = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!d) throw new NotFoundError('Driver not found');
  if (actor.role === 'vendor' && d.vendorId !== actor.vendorId) {
    throw new ForbiddenError('You can only review drivers belonging to your vendor');
  }
  if (d.status !== 'pending') throw new ValidationError('Only a pending sign-up can be rejected');
  await closeSignup(driverId, 'rejected');
  logger.info({ driverId, by: actor.role }, 'Driver sign-up rejected');
}

/**
 * Expire self sign-up requests that weren't approved in time. Only touches
 * rows with signupSource 'self' (older/test rows have NULL and are left alone).
 */
export async function expireStaleSignups(): Promise<number> {
  const cutoff = new Date(Date.now() - SIGNUP_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.driver.findMany({
    where: { status: 'pending', signupSource: 'self', createdAt: { lt: cutoff } },
    select: { id: true },
  });
  for (const s of stale) await closeSignup(s.id, 'expired');
  if (stale.length > 0) logger.info({ count: stale.length }, 'Expired unapproved sign-up requests');
  return stale.length;
}

let timer: NodeJS.Timeout | null = null;

/** Hourly sweep for expired sign-up requests. */
export function initSignupSweeper(): void {
  if (timer) clearInterval(timer);
  const run = () => expireStaleSignups().catch((err) => logger.error({ err }, 'Sign-up expiry sweep failed'));
  run();
  timer = setInterval(run, 60 * 60 * 1000);
}

export function stopSignupSweeper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
