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

// POST /auth/register
router.post(
  '/auth/register',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = RegisterSchema.parse(req.body);
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

// POST /auth/driver/request-otp
router.post(
  '/auth/driver/request-otp',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { phone } = RequestOtpSchema.parse(req.body);

      // In dev-bypass mode, skip Redis rate-limit and bcrypt OTP storage entirely.
      // The driver just types DEV_OTP_BYPASS directly in the verify step.
      if (process.env.DEV_OTP_BYPASS) {
        res.json({ message: `OTP sent (dev mode: use ${process.env.DEV_OTP_BYPASS})` });
        return;
      }

      await checkOtpRateLimit(phone);
      const otp = generateOtp();
      await storeOtp(phone, otp);
      await smsSender.send(phone, `Your RideOps OTP is: ${otp}. Valid for 10 minutes.`);
      res.json({ message: 'OTP sent successfully' });
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/driver/register — driver self-registers using vendor code
const DriverRegisterSchema = z.object({
  phone: z.string().min(10).max(15),
  fullName: z.string().min(2).max(100),
  vendorCode: z.string().min(1).max(20),
});

router.post(
  '/auth/driver/register',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { phone, fullName, vendorCode } = DriverRegisterSchema.parse(req.body);
      const vendor = await (await import('../lib/prisma')).prisma.vendor.findUnique({
        where: { vendorCode: vendorCode.toUpperCase() },
        select: { id: true, name: true },
      });
      if (!vendor) {
        res.status(400).json({ error: 'Invalid vendor code. Check with your fleet manager.', code: 'INVALID_VENDOR_CODE' });
        return;
      }
      const existing = await (await import('../lib/prisma')).prisma.driver.findUnique({ where: { phone } });
      if (existing) {
        res.status(409).json({ error: 'A driver account with this phone number already exists. Please sign in instead.', code: 'DRIVER_EXISTS' });
        return;
      }
      await (await import('../lib/prisma')).prisma.driver.create({
        data: { phone, fullName, vendorId: vendor.id, status: 'pending', kycStatus: 'pending' },
      });
      // Send OTP to verify phone
      if (!process.env.DEV_OTP_BYPASS) {
        await checkOtpRateLimit(phone);
        const otp = generateOtp();
        await storeOtp(phone, otp);
        await smsSender.send(phone, `Your RideOps OTP is: ${otp}. Valid for 10 minutes.`);
      }
      res.status(201).json({ message: 'Account created. OTP sent to your phone.', vendorName: vendor.name });
    } catch (err) {
      next(err);
    }
  },
);

// POST /auth/driver/verify-otp
router.post(
  '/auth/driver/verify-otp',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { phone, otp } = VerifyOtpSchema.parse(req.body);
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
