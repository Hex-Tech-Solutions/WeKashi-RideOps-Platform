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
import { requireIndianMobile, findDriverByPhone, zIndianMobile } from '../lib/identity';
import { submitSignupRequest } from '../services/signup.service';
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
      // Sign-up requests can't sign in until the vendor approves them.
      if (driver.status !== 'active') {
        res.status(403).json({
          error: 'Your account is waiting for your vendor\'s approval. You can sign in once it is approved.',
          code: 'ACCOUNT_PENDING',
        });
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

// POST /auth/driver/register — driver sign-up REQUEST. No OTP is sent (so the
// form can't be used to spam SMS). The account waits as 'pending' until the
// vendor approves it; only then can the driver sign in with an OTP.
const DriverRegisterSchema = z.object({
  phone: z.string().min(10).max(15),
  fullName: z.string().trim().min(2).max(100),
  vehicleNo: z.string().min(4).max(20),
  vendorCode: z.string().min(1).max(20),
});

router.post(
  '/auth/driver/register',
  authRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = DriverRegisterSchema.parse(req.body);
      const { vendorName } = await submitSignupRequest(body);
      res.status(201).json({
        message: 'Sign-up request sent. You can sign in once your vendor approves it.',
        vendorName,
      });
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
  mobile:      zIndianMobile(),
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
