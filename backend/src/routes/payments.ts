/**
 * Payment routes (subscription-payments model)
 *
 * The old wallet-and-payout collection flow has been removed. Under the new
 * model:
 *   - Supervisors pay drivers DIRECTLY via a UPI QR after a ride completes
 *     (untracked, off-platform). See GET /payments/pending and the pay-QR
 *     endpoint on the rides router.
 *   - Drivers pay the PLATFORM for ride-credit packs via Cashfree (tracked).
 *     The pack-purchase webhook lives here so Cashfree has a single endpoint.
 *
 * Endpoints:
 *   GET  /payments/pending    — supervisor: unpaid completed rides + driver UPI
 *   POST /payments/webhook    — Cashfree webhook (PAYMENT_SUCCESS)
 */

import { Router, Response, NextFunction, Request } from 'express';
import express from 'express';
import { prisma } from '../lib/prisma';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { logger } from '../lib/logger';
import { verifyWebhookSignature } from '../lib/cashfree';
import { activateFromWebhook } from '../services/packOrder.service';
import { buildUpiIntent } from '../lib/upiQr';
import type { AuthRequest } from '../types';

const router = Router();

// ─── Supervisor: pending payments ─────────────────────────────────────────────
// Completed rides the supervisor still owes for. Each row carries the driver's
// verified UPI VPA + name so the app can render a pay-QR to settle directly.

router.get(
  '/pending',
  authenticate, requireRole('supervisor'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const rides = await prisma.ride.findMany({
        where: {
          supervisorId: req.user!.id,
          status: 'completed',
          paymentStatus: 'unpaid',
          driverId: { not: null },
          price: { not: null },
        },
        select: {
          id: true, type: true, price: true, escortCharge: true,
          totalAmount: true, distanceKm: true, pickupAddress: true, dropAddress: true,
          completedAt: true, paymentStatus: true,
          driver: {
            select: { id: true, fullName: true, phone: true, upiVpa: true, upiVpaName: true, upiVerified: true },
          },
        },
        orderBy: { completedAt: 'desc' },
      });

      const withQr = rides.map((r) => {
        const amount = r.totalAmount ?? ((r.price ?? 0) + (r.escortCharge ?? 0));
        const canPay = !!r.driver?.upiVerified && !!r.driver?.upiVpa;
        return {
          ...r,
          amount,
          upiIntent: canPay
            ? buildUpiIntent({
                vpa: r.driver!.upiVpa!,
                payeeName: r.driver!.upiVpaName ?? r.driver!.fullName,
                amount,
                note: `RideOps ${r.id.slice(-8)}`,
              })
            : null,
          payeeName: r.driver?.upiVpaName ?? null,
        };
      });

      res.json({ rides: withQr });
    } catch (err) { next(err); }
  },
);

// ─── Cashfree webhook (pack purchases) ────────────────────────────────────────
// Fires on PAYMENT_SUCCESS. Verifies the signature over `timestamp + rawBody`,
// then idempotently activates the pack (no-op if /packs/verify already did).
// Mounted with express.raw() (see app.ts webhook-path exclusion).

router.post('/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
    const sig = req.headers['x-webhook-signature'] as string | undefined;
    const ts = req.headers['x-webhook-timestamp'] as string | undefined;
    if (!sig || !ts || !verifyWebhookSignature(rawBody, sig, ts)) {
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const event = JSON.parse(rawBody) as {
      type?: string;
      data?: {
        order?: { order_id?: string };
        payment?: { cf_payment_id?: string | number; payment_status?: string };
      };
    };

    // Cashfree payment webhooks use type 'PAYMENT_SUCCESS_WEBHOOK'.
    if (event.type === 'PAYMENT_SUCCESS_WEBHOOK' && event.data?.payment?.payment_status === 'SUCCESS') {
      const orderId = event.data.order?.order_id;
      const paymentId = event.data.payment?.cf_payment_id;
      if (orderId) {
        await activateFromWebhook(orderId, paymentId != null ? String(paymentId) : undefined);
        logger.info({ orderId }, 'Webhook: Cashfree pack payment success');
      }
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
