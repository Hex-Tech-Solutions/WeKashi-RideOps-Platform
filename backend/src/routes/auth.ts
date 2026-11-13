import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  registerUser,
  loginUser,
  refreshTokens,
  logout,
  loginDriverWithOtp,
} from '../services/auth.service';
import {
  submitRegistrationRequest,
} from '../services/admin.service';
import { checkOtpRateLimit, generateOtp, storeOtp, verifyOtp } from '../lib/otp';
import { smsSender } from '../lib/sms';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import {
  requireIndianMobile, findDriverByPhone, assertNoIdentityConflict, IDENTITY_CONFLICT_MESSAGE,
} from '../lib/identity';
import { ConflictError } from '../types';
import { authenticate } from '../middleware/authenticate';
import { authRateLimiter, refreshRateLimiter, otpRateLimiter } from '../middleware/rateLimiter';
import type { AuthRequest } from '../types';

const router = Router();

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(100),
  role: z.enum(['admin', 'supervisor', 'vendor']),
  fullName: z.string().min(2).max(100),
  org: z.string().max(100).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const RequestOtpSchema = z.object({
  phone: z.string().min(10).max(15),
});

const VerifyOtpSchema = z.object({
  phone: z.string().min(10).max(15),
  otp: z.string().length(6),
});

// POST /auth/register — ADMIN bootstrap only (invite-token gated in the service).
// Supervisor and vendor accounts must NOT be self-serviceable here: that was an
// open door to mint privileged accounts anonymously. The public signup path is
// POST /auth/register-request, which creates a pending request an admin reviews
// and approves. Any non-admin role submitted here is rejected outright.
router.post(
  '/auth/register',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = RegisterSchema.parse(req.body);
      if (body.role !== 'admin') {
        res.status(403).json({
          error: 'Self-registration is not allowed. Submit a request for admin approval instead.',
          code: 'REGISTRATION_NOT_ALLOWED',
        });
        return;
      }
      const inviteToken = req.headers['x-invite-token'] as string | undefined;

      const tokens = await registerUser({ ...body, inviteToken });
      res.status(201).json(tokens);
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/login
router.post(
  '/auth/login',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = LoginSchema.parse(req.body);
      const result = await loginUser(email, password);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/refresh
router.post(
  '/auth/refresh',
  refreshRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = RefreshSchema.parse(req.body);
      const tokens = await refreshTokens(refreshToken);
      res.json(tokens);
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/logout
router.post(
  '/auth/logout',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = RefreshSchema.parse(req.body);
      await logout(refreshToken);
      res.json({ message: 'Logged out successfully' });
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/driver/request-otp — SIGN IN. An OTP is sent only when an account
// exists for the number and isn't suspended; no SMS is spent otherwise.
router.post(
  '/auth/driver/request-otp',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const phone = requireIndianMobile(RequestOtpSchema.parse(req.body).phone);

      const driver = await findDriverByPhone(phone);
      if (!driver) {
        res.status(404).json({
          error: 'No account found for this number. Ask your vendor to add you, or register as a new driver.',
          code: 'NO_ACCOUNT',
        });
        return;
      }
      if (driver.status === 'blacklisted' || driver.status === 'expired') {
        res.status(403).json({ error: 'This account is suspended. Contact your vendor.', code: 'ACCOUNT_SUSPENDED' });
        return;
      }

      await checkOtpRateLimit(phone);
      const otp = generateOtp();
      await storeOtp(phone, otp);
      await smsSender.sendLoginOtp(phone, otp);
      res.json({ message: 'OTP sent successfully' });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Driver self-registration (OTP first) ────────────────────────────────────
// 1) /register/request-otp validates the details, checks for duplicates and
//    texts an OTP. Nothing is created yet — the details wait in Redis.
// 2) /register/verify checks the OTP, re-checks duplicates, then creates the
//    account and signs the driver in. A number can't be claimed without
//    proving the person holds that phone.
const DriverRegisterSchema = z.object({
  phone: z.string().min(10).max(15),
  fullName: z.string().trim().min(2).max(100),
  vendorCode: z.string().min(1).max(20),
});
const PENDING_SIGNUP_TTL = 15 * 60; // seconds — longer than the OTP's 10 min
const pendingSignupKey = (phone: string) => `signup:pending:${phone}`;

router.post(
  '/auth/driver/register/request-otp',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = DriverRegisterSchema.parse(req.body);
      const phone = requireIndianMobile(body.phone);
      const vendor = await prisma.vendor.findUnique({
        where: { vendorCode: body.vendorCode.toUpperCase().trim() },
        select: { id: true, name: true },
      });
      if (!vendor) {
        res.status(400).json({ error: 'Invalid vendor code. Check with your fleet manager.', code: 'INVALID_VENDOR_CODE' });
        return;
      }
      await assertNoIdentityConflict({ phone }, undefined, 'self-register');

      await checkOtpRateLimit(phone);
      await redis.set(
        pendingSignupKey(phone),
        JSON.stringify({ fullName: body.fullName, vendorId: vendor.id }),
        'EX',
        PENDING_SIGNUP_TTL,
      );
      const otp = generateOtp();
      await storeOtp(phone, otp);
      await smsSender.sendLoginOtp(phone, otp);
      res.json({ message: 'OTP sent. Enter it to create your account.', vendorName: vendor.name });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/auth/driver/register/verify',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { otp, phone: rawPhone } = VerifyOtpSchema.parse(req.body);
      const phone = requireIndianMobile(rawPhone);

      const pendingRaw = await redis.get(pendingSignupKey(phone));
      if (!pendingRaw) {
        res.status(410).json({ error: 'Sign-up timed out. Please start again.', code: 'SIGNUP_EXPIRED' });
        return;
      }
      if (!(await verifyOtp(phone, otp))) {
        res.status(401).json({ error: 'Invalid or expired OTP', code: 'INVALID_OTP' });
        return;
      }
      const pending = JSON.parse(pendingRaw) as { fullName: string; vendorId: string };

      // Re-check: someone may have taken the number in the meantime.
      await assertNoIdentityConflict({ phone }, undefined, 'self-register');
      try {
        await prisma.driver.create({
          data: { phone, fullName: pending.fullName, vendorId: pending.vendorId, status: 'pending', kycStatus: 'pending' },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') throw new ConflictError(IDENTITY_CONFLICT_MESSAGE);
        throw e;
      }
      await redis.del(pendingSignupKey(phone));

      res.status(201).json(await loginDriverWithOtp(phone));
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/driver/verify-otp — SIGN IN with the OTP.
router.post(
  '/auth/driver/verify-otp',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { otp, phone: rawPhone } = VerifyOtpSchema.parse(req.body);
      const phone = requireIndianMobile(rawPhone);
      const valid = await verifyOtp(phone, otp);
      if (!valid) {
        res.status(401).json({ error: 'Invalid or expired OTP', code: 'INVALID_OTP' });
        return;
      }
      const result = await loginDriverWithOtp(phone);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/register-request — public, no auth required
// Vendor or supervisor submits account request for admin review.
const RegistrationRequestSchema = z.object({
  role:        z.enum(['supervisor', 'vendor']),
  fullName:    z.string().min(2).max(100),
  email:       z.string().email(),
  password:    z.string().min(8).max(100),
  mobile:      z.string().min(10).max(15),
  companyName: z.string().min(2).max(100),
  gstin:       z.string().max(20).optional(),
  address:     z.string().min(5).max(300),
});

router.post(
  '/auth/register-request',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = RegistrationRequestSchema.parse(req.body);
      const result = await submitRegistrationRequest(body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

// GET /auth/me
router.get(  '/auth/me',
  authenticate,
  (req: AuthRequest, res: Response) => {
    if (req.user) {
      res.json({ type: 'user', ...req.user });
    } else if (req.driver) {
      res.json({ type: 'driver', ...req.driver });
    } else {
      res.status(401).json({ error: 'Not authenticated', code: 'UNAUTHORIZED' });
    }
  },
);

export default router;
