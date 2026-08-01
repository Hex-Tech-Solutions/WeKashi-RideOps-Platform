/**
 * Payment routes — Razorpay Route split + driver onboarding + wallet fines.
 *
 * Money flow:
 *   Supervisor pays totalAmount = driverFare + escortCharge + platformFee + pendingCancellationFee
 *   → Razorpay order captures the full amount into your account
 *   → Route transfer to driver: (driverFare + escortCharge) - |walletFineDeficit|
 *     (escort charge belongs to the driver — it compensates for the extra passenger/risk)
 *   → Your account retains: platformFee + cancellationFee + any fine recovered
 *
 * Example: ₹500 fare, escort required (₹250 escort), no fine
 *   Supervisor pays:  ₹500 + ₹250 + ₹20 = ₹770
 *   Driver receives:  ₹500 + ₹250        = ₹750
 *   Platform retains: ₹20 (platform fee only)
 *
 * Driver Route onboarding:
 *   POST /payments/driver/onboard        — create Razorpay linked account
 *   POST /payments/driver/onboard/bank   — add bank/UPI, triggers verification
 *   GET  /payments/driver/onboard/status — check Razorpay verification status
 *
 * Supervisor:
 *   GET  /payments/pending               — list unpaid completed rides
 *   POST /payments/rides/:id/initiate    — create Razorpay order
 *   POST /payments/rides/:id/confirm     — verify + Route transfer + clear fine
 *   POST /payments/webhook               — Razorpay webhook backup
 *
 * Driver:
 *   GET  /payments/bank-detail           — fetch saved UPI/bank
 *   POST /payments/bank-detail           — save UPI/bank
 *   GET  /payments/wallet                — balance + payment history
 */

import { Router, Response, NextFunction, Request } from 'express';
import express from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { NotFoundError, ForbiddenError, ValidationError } from '../types';
import { logger } from '../lib/logger';
import type { AuthRequest } from '../types';
import crypto from 'crypto';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rzpAuth() {
  return Buffer.from(
    `${process.env.RAZORPAY_KEY_ID ?? ''}:${process.env.RAZORPAY_KEY_SECRET ?? ''}`,
  ).toString('base64');
}

async function rzpPost(path: string, body: object) {
  const res = await fetch(`https://api.razorpay.com${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${rzpAuth()}` },
    body:    JSON.stringify(body),
  });
  const data = await res.json() as any;
  if (!res.ok) throw new ValidationError(data?.error?.description ?? 'Razorpay API error');
  return data;
}

async function rzpGet(path: string) {
  const res = await fetch(`https://api.razorpay.com${path}`, {
    headers: { 'Authorization': `Basic ${rzpAuth()}` },
  });
  const data = await res.json() as any;
  if (!res.ok) throw new ValidationError(data?.error?.description ?? 'Razorpay API error');
  return data;
}

const isDev = !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET;

// ─── Supervisor: pending payments ─────────────────────────────────────────────

router.get(
  '/pending',
  authenticate, requireRole('supervisor'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const rides = await prisma.ride.findMany({
        where: {
          supervisorId: req.user!.id,
          status:        'completed',
          paymentStatus: 'unpaid',
          driverId:      { not: null },
          price:         { not: null },
        },
        include: {
          driver: {
            select: {
              id: true, fullName: true, phone: true,
              razorpayAccountId: true, razorpayAccountVerified: true,
              bankDetail: { select: { upiId: true, accountNo: true, ifsc: true, accountName: true, verified: true } },
            },
          },
        },
        orderBy: { completedAt: 'desc' },
      });
      res.json({ rides });
    } catch (err) { next(err); }
  },
);

// ─── Supervisor: initiate payment ─────────────────────────────────────────────

router.post(
  '/rides/:id/initiate',
  authenticate, requireRole('supervisor'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const ride = await prisma.ride.findUnique({
        where: { id: req.params.id },
        include: {
          driver: {
            select: {
              id: true, fullName: true, walletBalance: true,
              razorpayAccountId: true, razorpayAccountVerified: true,
            },
          },
        },
      });

      if (!ride)                               throw new NotFoundError('Ride not found');
      if (ride.supervisorId !== req.user!.id)  throw new ForbiddenError('Not your ride');
      if (ride.status !== 'completed')         throw new ValidationError('Only completed rides can be paid');
      if (ride.paymentStatus === 'paid')       throw new ValidationError('Already paid');
      if (!ride.driverId)                      throw new ValidationError('No driver on this ride');
      if (!ride.price || ride.price <= 0)      throw new ValidationError('No fare set');

      const driverFare     = ride.price;
      const platformFee    = ride.platformFee  ?? 20;
      const escortFee      = (ride as any).escortCharge ?? 0;
      // totalAmount stored at ride creation already includes escortFee; fall back to recompute
      const totalAmount    = ride.totalAmount  ?? (driverFare + escortFee + platformFee);
      const amountPaise    = Math.round(totalAmount * 100);

      // Driver fine deficit
      const walletBalance  = ride.driver?.walletBalance ?? 0;
      const fineDeduction  = walletBalance < 0 ? Math.abs(walletBalance) : 0;
      // Driver receives: fare + escort charge (escort belongs to driver, not platform)
      const driverReceives = Math.max(0, driverFare + escortFee - fineDeduction);

      if (isDev) {
        const mockOrderId = `order_mock_${Date.now()}`;
        await prisma.ride.update({ where: { id: ride.id }, data: { razorpayOrderId: mockOrderId } });
        res.json({
          orderId: mockOrderId, amount: amountPaise, currency: 'INR', keyId: 'rzp_test_mock',
          rideId: ride.id, driverFare, escortFee, platformFee, totalAmount, fineDeduction, driverReceives,
          driverName: ride.driver?.fullName ?? 'Driver', isMock: true,
        });
        return;
      }

      const order = await rzpPost('/v1/orders', {
        amount: amountPaise, currency: 'INR',
        receipt: `ride_${ride.id.slice(-8)}`,
        notes: { rideId: ride.id, driverId: ride.driverId, supervisorId: req.user!.id },
      });

      await prisma.ride.update({ where: { id: ride.id }, data: { razorpayOrderId: order.id } });

      res.json({
        orderId: order.id, amount: order.amount, currency: order.currency,
        keyId: process.env.RAZORPAY_KEY_ID,
        rideId: ride.id, driverFare, escortFee, platformFee, totalAmount, fineDeduction, driverReceives,
        driverName: ride.driver?.fullName ?? 'Driver', isMock: false,
      });
    } catch (err) { next(err); }
  },
);

// ─── Supervisor: confirm payment + Route transfer + fine recovery ─────────────

router.post(
  '/rides/:id/confirm',
  authenticate, requireRole('supervisor'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { razorpayPaymentId, razorpaySignature } = z.object({
        razorpayPaymentId: z.string().min(1),
        // Signature is optional only in dev mode — required in production
        razorpaySignature: process.env.NODE_ENV === 'production'
          ? z.string().min(1)
          : z.string().optional(),
      }).parse(req.body);

      const ride = await prisma.ride.findUnique({
        where: { id: req.params.id },
        include: { driver: { select: { id: true, walletBalance: true, razorpayAccountId: true, razorpayAccountVerified: true } } },
      });

      if (!ride)                              throw new NotFoundError('Ride not found');
      if (ride.supervisorId !== req.user!.id) throw new ForbiddenError('Not your ride');
      if (ride.paymentStatus === 'paid')      throw new ValidationError('Already paid');

      const keySecret = process.env.RAZORPAY_KEY_SECRET;

      // Verify signature
      if (keySecret && razorpaySignature && ride.razorpayOrderId) {
        const expected = crypto
          .createHmac('sha256', keySecret)
          .update(`${ride.razorpayOrderId}|${razorpayPaymentId}`)
          .digest('hex');
        if (expected !== razorpaySignature) throw new ValidationError('Payment signature invalid');
      }

      const driverFare    = ride.price!;
      const escortFee     = (ride as any).escortCharge ?? 0;
      const walletBalance = ride.driver?.walletBalance ?? 0;
      const fineDeduction = walletBalance < 0 ? Math.abs(walletBalance) : 0;
      // Driver receives fare + escort charge
      const driverReceives = Math.max(0, driverFare + escortFee - fineDeduction);

      // ── Razorpay Route transfer ─────────────────────────────────────────────
      let routeTransferred = false;
      const rzpAccountId  = ride.driver?.razorpayAccountId;

      if (!isDev && rzpAccountId && ride.driver?.razorpayAccountVerified && driverReceives > 0) {
        try {
          await rzpPost(`/v1/payments/${razorpayPaymentId}/transfers`, {
            transfers: [{
              account:  rzpAccountId,
              amount:   Math.round(driverReceives * 100), // paise
              currency: 'INR',
              notes:    { rideId: ride.id, escortFee, fineDeduction },
              on_hold:  0,
            }],
          });
          routeTransferred = true;
          logger.info({ rideId: ride.id, driverFare, escortFee, driverReceives, fineDeduction }, 'Razorpay Route transfer succeeded');
        } catch (e: any) {
          logger.warn({ rideId: ride.id, err: e.message }, 'Route transfer failed — wallet fallback');
        }
      }

      // ── DB: mark paid + adjust driver walletBalance ────────────────────────
      // walletBalance += driverFare + escortFee (fine deficit was already negative)
      const newWalletBalance = walletBalance + driverFare + escortFee;

      await prisma.$transaction([
        prisma.ride.update({
          where: { id: ride.id },
          data:  { paymentStatus: 'paid', razorpayPaymentId, paidAt: new Date() },
        }),
        prisma.driver.update({
          where: { id: ride.driverId! },
          data:  { walletBalance: newWalletBalance },
        }),
      ]);

      logger.info({ rideId: ride.id, driverFare, escortFee, fineDeduction, driverReceives, routeTransferred }, 'Payment confirmed');
      res.json({ ok: true, routeTransferred, driverFare, escortFee, fineDeduction, driverReceives });
    } catch (err) { next(err); }
  },
);

// ─── Razorpay webhook ─────────────────────────────────────────────────────────

router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (secret) {
      const sig      = req.headers['x-razorpay-signature'] as string;
      // Must use raw bytes — JSON.stringify of a parsed body will not match
      const rawBody  = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      if (sig !== expected) { res.status(400).json({ error: 'Invalid signature' }); return; }
    }

    const event = JSON.parse(req.body.toString()) as any;
    if (event.event === 'payment.captured') {
      const payment = event.payload?.payment?.entity;
      const rideId  = payment?.notes?.rideId;
      if (rideId) {
        const ride = await prisma.ride.findUnique({
          where: { id: rideId },
          include: { driver: { select: { walletBalance: true } } },
        });
        if (ride && ride.paymentStatus !== 'paid' && ride.driverId && ride.price) {
          const walletBalance  = ride.driver?.walletBalance ?? 0;
          const escortFee      = (ride as any).escortCharge ?? 0;
          const newBalance     = walletBalance + ride.price + escortFee;
          await prisma.$transaction([
            prisma.ride.update({ where: { id: rideId }, data: { paymentStatus: 'paid', razorpayPaymentId: payment.id, paidAt: new Date() } }),
            prisma.driver.update({ where: { id: ride.driverId }, data: { walletBalance: newBalance } }),
          ]);
          logger.info({ rideId }, 'Webhook: payment captured');
        }
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Driver: Razorpay Route onboarding ───────────────────────────────────────
//
// Step 1: POST /payments/driver/onboard
//   Creates a Razorpay Route linked account for this driver.
//   Stores acc_xxx as razorpayAccountId on the driver record.
//
// Step 2: POST /payments/driver/onboard/bank
//   Adds the driver's bank/UPI to their linked account.
//   Razorpay runs a penny-drop verification.
//
// Step 3: GET /payments/driver/onboard/status
//   Checks if Razorpay has verified the bank account.
//   Sets razorpayAccountVerified = true when done.

router.post(
  '/driver/onboard',
  authenticate, requireRole('driver'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const driver = await prisma.driver.findUnique({
        where: { id: req.driver!.id },
        select: { id: true, fullName: true, phone: true, razorpayAccountId: true },
      });
      if (!driver) throw new NotFoundError('Driver not found');

      // Already onboarded
      if (driver.razorpayAccountId) {
        res.json({ razorpayAccountId: driver.razorpayAccountId, alreadyExists: true });
        return;
      }

      if (isDev) {
        const mockId = `acc_mock_${driver.id.slice(-8)}`;
        await prisma.driver.update({ where: { id: driver.id }, data: { razorpayAccountId: mockId } });
        res.json({ razorpayAccountId: mockId, isMock: true });
        return;
      }

      // Create Razorpay Route linked account
      const account = await rzpPost('/v2/accounts', {
        email:                `driver_${driver.id.slice(-8)}@rideops.app`, // placeholder
        profile:              { category: 'transportation', subcategory: 'taxi_cab', addresses: { registered: { street1: 'India', city: 'Bengaluru', state: 'Karnataka', postal_code: '560001', country: 'IN' } } },
        type:                 'route',
        legal_business_name:  driver.fullName,
        business_type:        'individual',
        contact_name:         driver.fullName,
        contact_info:         { phone: driver.phone },
      });

      await prisma.driver.update({
        where: { id: driver.id },
        data:  { razorpayAccountId: account.id },
      });

      logger.info({ driverId: driver.id, razorpayAccountId: account.id }, 'Razorpay linked account created');
      res.json({ razorpayAccountId: account.id });
    } catch (err) { next(err); }
  },
);

router.post(
  '/driver/onboard/bank',
  authenticate, requireRole('driver'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { upiId, accountNo, ifsc, accountName } = z.object({
        upiId:       z.string().max(50).optional(),
        accountNo:   z.string().max(30).optional(),
        ifsc:        z.string().length(11).optional(),
        accountName: z.string().max(100).optional(),
      }).refine((d) => d.upiId || d.accountNo, { message: 'Provide UPI ID or bank account' })
        .parse(req.body);

      const driver = await prisma.driver.findUnique({
        where: { id: req.driver!.id },
        select: { id: true, razorpayAccountId: true },
      });
      if (!driver) throw new NotFoundError('Driver not found');
      if (!driver.razorpayAccountId) throw new ValidationError('Complete onboarding step 1 first');

      // Save locally
      await prisma.driverBankDetail.upsert({
        where:  { driverId: driver.id },
        create: { driverId: driver.id, upiId: upiId ?? null, accountNo: accountNo ?? null, ifsc: ifsc ?? null, accountName: accountName ?? null, verified: false },
        update: { upiId: upiId ?? null, accountNo: accountNo ?? null, ifsc: ifsc ?? null, accountName: accountName ?? null, verified: false },
      });

      if (isDev) {
        // Dev: auto-verify
        await prisma.$transaction([
          prisma.driverBankDetail.update({ where: { driverId: driver.id }, data: { verified: true } }),
          prisma.driver.update({ where: { id: driver.id }, data: { razorpayAccountVerified: true } }),
        ]);
        res.json({ ok: true, isMock: true, verified: true });
        return;
      }

      // Add stakeholder + bank to Razorpay account
      if (accountNo && ifsc) {
        await rzpPost(`/v2/accounts/${driver.razorpayAccountId}/stakeholders`, {
          name:              accountName ?? 'Driver',
          bank_account:      { ifsc_code: ifsc, beneficiary_name: accountName ?? 'Driver', account_number: accountNo },
          relationship:      { director: true },
        });
      } else if (upiId) {
        await rzpPost(`/v2/accounts/${driver.razorpayAccountId}/stakeholders`, {
          name:              accountName ?? 'Driver',
          relationship:      { director: true },
          vpa:               upiId,
        });
      }

      res.json({ ok: true, isMock: false, verified: false, message: 'Verification in progress — check status shortly' });
    } catch (err) { next(err); }
  },
);

router.get(
  '/driver/onboard/status',
  authenticate, requireRole('driver'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const driver = await prisma.driver.findUnique({
        where: { id: req.driver!.id },
        select: {
          razorpayAccountId: true,
          razorpayAccountVerified: true,
          bankDetail: { select: { upiId: true, accountNo: true, ifsc: true, verified: true } },
        },
      });
      if (!driver) throw new NotFoundError('Driver not found');

      if (!driver.razorpayAccountId) {
        res.json({ step: 'not_started', verified: false });
        return;
      }
      if (driver.razorpayAccountVerified) {
        res.json({ step: 'complete', verified: true, razorpayAccountId: driver.razorpayAccountId });
        return;
      }

      if (isDev) {
        res.json({ step: 'complete', verified: true, isMock: true });
        return;
      }

      // Check Razorpay account status
      const account = await rzpGet(`/v2/accounts/${driver.razorpayAccountId}`);
      const verified = account.profile?.verification?.bank_account?.status === 'verified'
                    || account.profile?.verification?.vpa?.status === 'verified';

      if (verified && !driver.razorpayAccountVerified) {
        await prisma.$transaction([
          prisma.driver.update({ where: { id: req.driver!.id }, data: { razorpayAccountVerified: true } }),
          prisma.driverBankDetail.updateMany({ where: { driverId: req.driver!.id }, data: { verified: true } }),
        ]);
      }

      res.json({
        step:               verified ? 'complete' : 'pending_verification',
        verified,
        razorpayAccountId:  driver.razorpayAccountId,
        razorpayStatus:     account.profile?.verification,
      });
    } catch (err) { next(err); }
  },
);

// ─── Driver: bank detail (simple CRUD, used alongside onboarding) ─────────────

const BankDetailSchema = z.object({
  upiId:       z.string().max(50).optional(),
  accountNo:   z.string().max(30).optional(),
  ifsc:        z.string().length(11).optional(),
  accountName: z.string().max(100).optional(),
}).refine((d) => d.upiId || d.accountNo, { message: 'Provide UPI ID or bank account' });

router.get('/bank-detail', authenticate, requireRole('driver'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const detail = await prisma.driverBankDetail.findUnique({ where: { driverId: req.driver!.id } });
    const driver = await prisma.driver.findUnique({ where: { id: req.driver!.id }, select: { razorpayAccountId: true, razorpayAccountVerified: true } });
    res.json({ bankDetail: detail, razorpayAccountId: driver?.razorpayAccountId, razorpayAccountVerified: driver?.razorpayAccountVerified ?? false });
  } catch (err) { next(err); }
});

router.post('/bank-detail', authenticate, requireRole('driver'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = BankDetailSchema.parse(req.body);
    const detail = await prisma.driverBankDetail.upsert({
      where:  { driverId: req.driver!.id },
      create: { driverId: req.driver!.id, ...body, verified: false },
      update: { ...body, verified: false },
    });
    res.json({ bankDetail: detail });
  } catch (err) { next(err); }
});

// ─── Driver: wallet ───────────────────────────────────────────────────────────

router.get('/wallet', authenticate, requireRole('driver'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const driver = await prisma.driver.findUnique({
      where: { id: req.driver!.id },
      select: { walletBalance: true },
    });
    const payments = await prisma.ride.findMany({
      where: { driverId: req.driver!.id, paymentStatus: 'paid' },
      select: {
        id: true, price: true, platformFee: true, totalAmount: true, paidAt: true,
        type: true, pickupAddress: true, dropAddress: true,
        supervisor: { select: { fullName: true, org: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 20,
    });
    res.json({ walletBalance: driver?.walletBalance ?? 0, payments });
  } catch (err) { next(err); }
});

export default router;
