/**
 * Payment routes
 *
 * ── Collection (Razorpay Payments) ────────────────────────────────────────────
 * Supervisor pays via Standard Checkout → full amount captured in your account.
 * Driver's in-app wallet is credited. Driver withdraws via Razorpay X Payouts.
 *
 * Money flow (collection):
 *   Supervisor pays = driverFare + escortCharge + platformFee + cancellationFee
 *   → Razorpay order created, checkout opened
 *   → On payment captured: signature verified, driver wallet credited
 *   → Platform retains: platformFee (₹20) + cancellationFee
 *   → Driver receives: driverFare + escortCharge (via wallet, then withdrawal)
 *
 * ── Disbursement (Razorpay X Payouts) ─────────────────────────────────────────
 * Driver sees wallet balance → taps Withdraw → backend calls Razorpay X Payouts.
 * Uses Composite Payout API (single call, no pre-registration needed).
 *
 * Fee structure (charged to driver):
 *   ₹5 flat fee + 18% GST = ₹5.90 per payout (deducted from wallet)
 *   Driver requests ₹X → wallet debited ₹(X + 5.90) → bank receives ₹X
 *   Minimum withdrawal: ₹1 (so min wallet needed = ₹6.90)
 *
 * Endpoints:
 *   GET  /payments/pending               — supervisor: unpaid completed rides
 *   POST /payments/rides/:id/initiate    — supervisor: create Razorpay order
 *   POST /payments/rides/:id/confirm     — supervisor: verify + credit wallet
 *   POST /payments/webhook               — Razorpay Payments webhook (backup)
 *   POST /payments/payout-webhook        — Razorpay X payout status webhook
 *   GET  /payments/bank-detail           — driver: fetch saved UPI/bank
 *   POST /payments/bank-detail           — driver: save UPI/bank
 *   POST /payments/driver/withdraw       — driver: request payout
 *   GET  /payments/driver/payouts        — driver: payout history
 *   GET  /payments/wallet                — driver: wallet balance + ride earnings
 */

import { Router, Response, NextFunction, Request } from 'express';
import express from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { NotFoundError, ForbiddenError, ValidationError } from '../types';
import { logger } from '../lib/logger';
import type { AuthRequest } from '../types';
import crypto from 'crypto';

const router = Router();

// ─── Payout fee constants ──────────────────────────────────────────────────────
const PAYOUT_FEE     = 5.00;  // Razorpay flat fee per payout
const PAYOUT_GST     = 0.90;  // 18% GST on ₹5
export const PAYOUT_TOTAL_FEE = Math.round((PAYOUT_FEE + PAYOUT_GST) * 100) / 100; // ₹5.90
const PAYOUT_MIN_AMOUNT = 1;   // Minimum payout amount in ₹

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Auth header for Razorpay Payments API */
function rzpPaymentsAuth() {
  return Buffer.from(
    `${process.env.RAZORPAY_KEY_ID ?? ''}:${process.env.RAZORPAY_KEY_SECRET ?? ''}`,
  ).toString('base64');
}

/** Auth header for Razorpay X Payouts API (separate credentials) */
function rzpXAuth() {
  return Buffer.from(
    `${process.env.RAZORPAY_X_KEY_ID ?? ''}:${process.env.RAZORPAY_X_KEY_SECRET ?? ''}`,
  ).toString('base64');
}

async function rzpPost(path: string, body: object, useX = false) {
  const auth = useX ? rzpXAuth() : rzpPaymentsAuth();
  const res = await fetch(`https://api.razorpay.com${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
    body:    JSON.stringify(body),
  });
  const data = await res.json() as any;
  if (!res.ok) throw new ValidationError(data?.error?.description ?? 'Razorpay API error');
  return data;
}

const isDevPayments = !process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET;
const isDevPayouts  = !process.env.RAZORPAY_X_KEY_ID || !process.env.RAZORPAY_X_KEY_SECRET;

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
        select: {
          id: true, type: true, price: true, platformFee: true, escortCharge: true,
          totalAmount: true, distanceKm: true, pickupAddress: true, dropAddress: true,
          completedAt: true, paymentStatus: true,
          driver: {
            select: {
              id: true, fullName: true, phone: true, walletBalance: true,
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
        include: { driver: { select: { id: true, fullName: true, walletBalance: true } } },
      });

      if (!ride)                               throw new NotFoundError('Ride not found');
      if (ride.supervisorId !== req.user!.id)  throw new ForbiddenError('Not your ride');
      if (ride.status !== 'completed')         throw new ValidationError('Only completed rides can be paid');
      if (ride.paymentStatus === 'paid')       throw new ValidationError('Already paid');
      if (!ride.driverId)                      throw new ValidationError('No driver on this ride');
      if (!ride.price || ride.price <= 0)      throw new ValidationError('No fare set');

      const driverFare     = ride.price;
      const platformFee    = ride.platformFee ?? 20;
      const escortFee      = ride.escortCharge ?? 0;
      const cancellationFee = ride.cancellationFee ?? 0;
      // totalAmount stored at creation already includes escort + cancellation fee.
      // Fallback recompute includes ALL components so nothing is silently dropped.
      const totalAmount = ride.totalAmount ?? (driverFare + escortFee + platformFee + cancellationFee);
      const amountPaise = Math.round(totalAmount * 100);

      const walletBalance  = ride.driver?.walletBalance ?? 0;
      const fineDeduction  = walletBalance < 0 ? Math.abs(walletBalance) : 0;
      const driverReceives = Math.max(0, driverFare + escortFee - fineDeduction);

      if (isDevPayments) {
        const mockOrderId = `order_mock_${Date.now()}`;
        await prisma.ride.update({ where: { id: ride.id }, data: { razorpayOrderId: mockOrderId } });
        res.json({
          orderId: mockOrderId, amount: amountPaise, currency: 'INR', keyId: 'rzp_test_mock',
          rideId: ride.id, driverFare, escortFee, platformFee, cancellationFee, totalAmount, fineDeduction, driverReceives,
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
        rideId: ride.id, driverFare, escortFee, platformFee, cancellationFee, totalAmount, fineDeduction, driverReceives,
        driverName: ride.driver?.fullName ?? 'Driver', isMock: false,
      });
    } catch (err) { next(err); }
  },
);

// ─── Supervisor: confirm payment + credit driver wallet ───────────────────────

router.post(
  '/rides/:id/confirm',
  authenticate, requireRole('supervisor'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { razorpayPaymentId, razorpaySignature } = z.object({
        razorpayPaymentId: z.string().min(1),
        razorpaySignature: process.env.NODE_ENV === 'production'
          ? z.string().min(1)
          : z.string().optional(),
      }).parse(req.body);

      const ride = await prisma.ride.findUnique({
        where: { id: req.params.id },
        include: { driver: { select: { id: true, walletBalance: true } } },
      });

      if (!ride)                              throw new NotFoundError('Ride not found');
      if (ride.supervisorId !== req.user!.id) throw new ForbiddenError('Not your ride');
      if (ride.paymentStatus === 'paid')      throw new ValidationError('Already paid');

      // Verify Razorpay signature
      const keySecret = process.env.RAZORPAY_KEY_SECRET;
      if (keySecret && razorpaySignature && ride.razorpayOrderId) {
        const expected = crypto
          .createHmac('sha256', keySecret)
          .update(`${ride.razorpayOrderId}|${razorpayPaymentId}`)
          .digest('hex');
        if (expected !== razorpaySignature) throw new ValidationError('Payment signature invalid');
      }

      // Compute earnings figures up front so they're available in both branches below
      const driverFare     = ride.price!;
      const escortFee      = ride.escortCharge ?? 0;
      const walletBalance  = ride.driver?.walletBalance ?? 0;
      const fineDeduction  = walletBalance < 0 ? Math.abs(walletBalance) : 0;
      const driverReceives = Math.max(0, driverFare + escortFee - fineDeduction);

      // ── Atomic payment confirmation + wallet credit ──────────────────────
      // Both writes happen in ONE transaction: mark the ride 'paid' AND credit
      // the driver's wallet. If either fails, BOTH are rolled back — the ride
      // stays 'unpaid' and simply reappears in /payments/pending for retry.
      // This guarantees a ride can never end up "paid" with an un-credited
      // driver wallet (the original bug: two separate writes meant a crash
      // between them left payment_status='paid' but no money in the wallet,
      // with no way to detect or recover it). Uses increment (not a computed
      // absolute value) so concurrent credits to the same driver never race.
      const alreadyPaid = await prisma.$transaction(async (tx) => {
        const updated = await tx.$executeRaw`
          UPDATE rides
          SET payment_status = 'paid',
              razorpay_payment_id = ${razorpayPaymentId},
              paid_at = NOW()
          WHERE id = ${ride.id}
            AND payment_status = 'unpaid'
        `;
        if (updated === 0) return true; // another request already confirmed this ride

        await tx.driver.update({
          where: { id: ride.driverId! },
          data:  { walletBalance: { increment: driverFare + escortFee } },
        });
        return false;
      });

      if (alreadyPaid) {
        res.json({ ok: true, alreadyPaid: true, driverFare, escortFee, fineDeduction, driverReceives });
        return;
      }

      logger.info({ rideId: ride.id, driverFare, escortFee, fineDeduction, driverReceives }, 'Payment confirmed — wallet credited');
      res.json({ ok: true, driverFare, escortFee, fineDeduction, driverReceives });
    } catch (err) { next(err); }
  },
);

// ─── Razorpay Payments webhook (backup for missed confirms) ───────────────────

router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (secret) {
      const sig      = req.headers['x-razorpay-signature'] as string;
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
          // Same atomic pattern as /rides/:id/confirm — mark-paid and wallet
          // credit happen in ONE transaction, so a crash between them can
          // never leave a ride "paid" with no money in the driver's wallet.
          const escortFee = ride.escortCharge ?? 0;
          await prisma.$transaction(async (tx) => {
            const updated = await tx.$executeRaw`
              UPDATE rides
              SET payment_status = 'paid', razorpay_payment_id = ${payment.id}, paid_at = NOW()
              WHERE id = ${rideId} AND payment_status = 'unpaid'
            `;
            if (updated === 0) return; // /confirm already processed this — do not double-credit
            await tx.driver.update({
              where: { id: ride.driverId! },
              data:  { walletBalance: { increment: ride.price! + escortFee } },
            });
            logger.info({ rideId }, 'Webhook: payment captured — wallet credited');
          });
        }
      }
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Razorpay X Payout webhook ────────────────────────────────────────────────
// Handles: payout.processed, payout.failed, payout.reversed

router.post('/payout-webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = process.env.RAZORPAY_X_WEBHOOK_SECRET;
    if (secret) {
      const sig      = req.headers['x-razorpay-signature'] as string;
      const rawBody  = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
      if (sig !== expected) { res.status(400).json({ error: 'Invalid signature' }); return; }
    }

    const event   = JSON.parse(req.body.toString()) as any;
    const payout  = event.payload?.payout?.entity;
    const payoutId = payout?.id;

    if (!payoutId) { res.json({ ok: true }); return; }

    const txn = await prisma.payoutTransaction.findFirst({
      where: { razorpayPayoutId: payoutId },
    });

    if (!txn) {
      // Try idempotency key match (payout created in dev mock)
      logger.warn({ payoutId }, 'Payout webhook: no matching transaction found');
      res.json({ ok: true });
      return;
    }

    if (event.event === 'payout.processed') {
      await prisma.payoutTransaction.update({
        where: { id: txn.id },
        data:  { status: 'processed', utr: payout.utr ?? null },
      });
      logger.info({ payoutId, driverId: txn.driverId, amount: txn.amount }, 'Payout processed');
    } else if (event.event === 'payout.failed' || event.event === 'payout.reversed') {
      // Refund wallet — payout failed, money never left
      await prisma.$transaction([
        prisma.payoutTransaction.update({
          where: { id: txn.id },
          data:  { status: event.event === 'payout.failed' ? 'failed' : 'reversed' },
        }),
        prisma.driver.update({
          where: { id: txn.driverId },
          data:  { walletBalance: { increment: txn.totalDeducted } },
        }),
      ]);
      logger.warn({ payoutId, driverId: txn.driverId, amount: txn.amount }, `Payout ${event.event} — wallet refunded`);
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─── Driver: bank detail ──────────────────────────────────────────────────────

const BankDetailSchema = z.object({
  upiId:       z.string().max(50).optional(),
  accountNo:   z.string().max(30).optional(),
  ifsc:        z.string().length(11).optional(),
  accountName: z.string().max(100).optional(),
}).refine((d) => d.upiId || d.accountNo, { message: 'Provide UPI ID or bank account' });

router.get('/bank-detail', authenticate, requireRole('driver'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const detail = await prisma.driverBankDetail.findUnique({ where: { driverId: req.driver!.id } });
    res.json({ bankDetail: detail });
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

// ─── Driver: request withdrawal (Razorpay X Composite Payout API) ─────────────
//
// Flow:
//   1. Validate amount + fee fits in wallet balance
//   2. Debit wallet immediately (prevents double-spend)
//   3. Create idempotency key, call Razorpay X Composite Payout API
//   4. Store PayoutTransaction with razorpayPayoutId
//   5. Webhook (payout.failed/reversed) refunds wallet if payout fails

router.post(
  '/driver/withdraw',
  authenticate, requireRole('driver'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { amount } = z.object({
        amount: z.number().min(PAYOUT_MIN_AMOUNT, `Minimum withdrawal is ₹${PAYOUT_MIN_AMOUNT}`),
      }).parse(req.body);

      const driver = await prisma.driver.findUnique({
        where: { id: req.driver!.id },
        select: { id: true, fullName: true, phone: true, walletBalance: true, bankDetail: true },
      });
      if (!driver) throw new NotFoundError('Driver not found');

      const bankDetail = driver.bankDetail;
      if (!bankDetail || (!bankDetail.upiId && !bankDetail.accountNo)) {
        throw new ValidationError('Add a UPI ID or bank account before withdrawing');
      }

      const totalDeducted = Math.round((amount + PAYOUT_TOTAL_FEE) * 100) / 100;
      if (driver.walletBalance < totalDeducted) {
        throw new ValidationError(
          `Insufficient balance. You need ₹${totalDeducted} (₹${amount} + ₹${PAYOUT_TOTAL_FEE} fee). Available: ₹${driver.walletBalance.toFixed(2)}`,
        );
      }

      const mode            = bankDetail.upiId ? 'UPI' : 'IMPS';
      const idempotencyKey  = uuidv4();
      const narration       = 'WeKashi RideOps';

      // ── Atomic wallet debit + payout record creation ────────────────────────
      // Both writes happen in ONE transaction: debit the wallet AND create the
      // PayoutTransaction audit record. Without this, a crash right after the
      // debit (before the record existed) would silently vanish money from
      // the driver's wallet with zero trace of why — worse than the ride
      // payment case, since no Razorpay payout call has even been attempted
      // yet at this point. If either write fails, both roll back and the
      // driver's balance is untouched.
      const txn = await prisma.$transaction(async (tx) => {
        // UPDATE with WHERE guard — only one concurrent request deducts.
        const deducted = await tx.$executeRaw`
          UPDATE drivers
          SET wallet_balance = wallet_balance - ${totalDeducted}
          WHERE id = ${driver.id}
            AND wallet_balance >= ${totalDeducted}
        `;
        if (deducted === 0) {
          throw new ValidationError(
            `Insufficient balance. You need ₹${totalDeducted} (₹${amount} + ₹${PAYOUT_TOTAL_FEE} fee).`,
          );
        }

        return tx.payoutTransaction.create({
          data: {
            driverId:       driver.id,
            amount,
            fee:            PAYOUT_TOTAL_FEE,
            totalDeducted,
            mode,
            status:         'processing',
            idempotencyKey,
            narration,
          },
        });
      });

      const newBalance = Math.round((driver.walletBalance - totalDeducted) * 100) / 100;

      // ── Dev mode: mock payout ──────────────────────────────────────────────
      if (isDevPayouts) {
        const mockPayoutId = `pout_mock_${Date.now()}`;
        await prisma.payoutTransaction.update({
          where: { id: txn.id },
          data:  { razorpayPayoutId: mockPayoutId, status: 'processed' },
        });
        logger.info({ driverId: driver.id, amount, mode }, 'DEV: mock payout processed');
        res.json({
          ok: true, amount, fee: PAYOUT_TOTAL_FEE, totalDeducted, mode,
          payoutId: mockPayoutId, status: 'processed', isMock: true,
          newWalletBalance: newBalance,
        });
        return;
      }

      // ── Razorpay X Composite Payout API ───────────────────────────────────
      try {
        const payoutBody: any = {
          account_number:       process.env.RAZORPAY_X_ACCOUNT_NUMBER,
          amount:               Math.round(amount * 100), // paise — driver receives exact amount
          currency:             'INR',
          mode,
          purpose:              'payout',
          queue_if_low_balance: true,
          reference_id:         txn.id.slice(-20), // max 40 chars
          narration,
          fund_account: {
            contact: {
              name:         driver.fullName,
              contact:      driver.phone,
              type:         'employee',
              reference_id: driver.id.slice(-20),
            },
          },
        };

        if (bankDetail.upiId) {
          payoutBody.fund_account.account_type = 'vpa';
          payoutBody.fund_account.vpa          = { address: bankDetail.upiId };
        } else {
          payoutBody.fund_account.account_type  = 'bank_account';
          payoutBody.fund_account.bank_account  = {
            name:           bankDetail.accountName ?? driver.fullName,
            ifsc:           bankDetail.ifsc!,
            account_number: bankDetail.accountNo!,
          };
        }

        const payout = await rzpPost('/v1/payouts', payoutBody, true);

        await prisma.payoutTransaction.update({
          where: { id: txn.id },
          data:  { razorpayPayoutId: payout.id, status: payout.status ?? 'processing' },
        });

        logger.info({ driverId: driver.id, amount, mode, payoutId: payout.id }, 'Payout initiated');
        res.json({
          ok: true, amount, fee: PAYOUT_TOTAL_FEE, totalDeducted, mode,
          payoutId: payout.id, status: payout.status,
          newWalletBalance: newBalance,
        });
      } catch (payoutErr: any) {
        // Payout API failed — refund the wallet deduction
        await prisma.$transaction([
          prisma.driver.update({
            where: { id: driver.id },
            data:  { walletBalance: { increment: totalDeducted } },
          }),
          prisma.payoutTransaction.update({
            where: { id: txn.id },
            data:  { status: 'failed' },
          }),
        ]);
        logger.error({ driverId: driver.id, err: payoutErr.message }, 'Payout API failed — wallet refunded');
        throw new ValidationError(payoutErr.message ?? 'Payout failed — no amount was deducted');
      }
    } catch (err) { next(err); }
  },
);

// ─── Driver: payout history ───────────────────────────────────────────────────

router.get(
  '/driver/payouts',
  authenticate, requireRole('driver'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const payouts = await prisma.payoutTransaction.findMany({
        where:   { driverId: req.driver!.id },
        orderBy: { createdAt: 'desc' },
        take:    20,
      });
      res.json({ payouts, payoutFee: PAYOUT_TOTAL_FEE });
    } catch (err) { next(err); }
  },
);

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
        id: true, price: true, escortCharge: true, platformFee: true, totalAmount: true, paidAt: true,
        type: true, pickupAddress: true, dropAddress: true,
        supervisor: { select: { fullName: true, org: true } },
      },
      orderBy: { paidAt: 'desc' },
      take: 20,
    });
    const balance = driver?.walletBalance ?? 0;
    const maxWithdrawable = Math.max(0, Math.round((balance - PAYOUT_TOTAL_FEE) * 100) / 100);
    res.json({ walletBalance: balance, maxWithdrawable, payoutFee: PAYOUT_TOTAL_FEE, payments });
  } catch (err) { next(err); }
});

export default router;
