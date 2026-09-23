// Pack_Payment_Service — creates Cashfree orders for pack purchases and
// activates the pack once payment is confirmed. Activation is idempotent: the
// client-confirm path and the webhook both call the same guarded function, and
// PackOrder.activatedPackId ensures at most one CreditPack per order.
//
// Unlike Razorpay, Cashfree has no client-side HMAC signature to trust. The
// authoritative check is a server-side order-status fetch (== 'PAID').

import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { PACK_CATALOG, PackKey, isPackKey } from '../lib/creditPacks';
import { createPackOrder as cfCreateOrder, getOrderStatus } from '../lib/cashfree';
import { activatePurchasedPack } from './creditPack.service';
import { ValidationError, NotFoundError } from '../types';
import { logger } from '../lib/logger';

export interface CreatedOrder {
  orderId: string;            // our order id (Cashfree order_id)
  paymentSessionId: string;   // used by the Cashfree JS checkout
  amount: number;             // rupees
  currency: string;
  appId: string;
  env: string;
  packKey: PackKey;
  credits: number;
}

/**
 * Create a Cashfree order for the selected pack and persist a PackOrder row.
 * (Req 6.1, 6.5)
 */
export async function createOrder(driverId: string, packKey: string): Promise<CreatedOrder> {
  if (!isPackKey(packKey)) throw new ValidationError('Unknown pack');
  const def = PACK_CATALOG[packKey];

  // Cashfree order_id must be unique per request and 3–45 chars, alnum/_/-.
  const orderId = `pack_${packKey}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

  const driver = await prisma.driver.findUnique({
    where: { id: driverId },
    select: { phone: true },
  });

  const order = await cfCreateOrder({
    orderId,
    amountRupees: def.price,
    customerId: driverId,
    customerPhone: driver?.phone ?? '9999999999',
  });

  await prisma.packOrder.create({
    data: {
      driverId,
      packKey,
      credits: def.credits,
      amount: def.price,
      gatewayOrderId: order.orderId,
      status: 'created',
    },
  });

  return {
    orderId: order.orderId,
    paymentSessionId: order.paymentSessionId,
    amount: order.amount,
    currency: order.currency,
    appId: order.appId,
    env: order.env,
    packKey,
    credits: def.credits,
  };
}

export interface ActivationResult {
  activated: boolean;
  packId?: string;
  credits: number;
}

/**
 * Client-confirm path: after the Cashfree checkout closes, the app calls this
 * with the order id. We fetch the authoritative order status; only if PAID do
 * we activate. (Req 6.2, 6.3, 6.4, 6.6)
 */
export async function confirmAndActivate(orderId: string): Promise<ActivationResult> {
  const order = await prisma.packOrder.findUnique({ where: { gatewayOrderId: orderId } });
  if (!order) throw new NotFoundError('Order not found');

  const status = await getOrderStatus(orderId);
  if (!status.isPaid) {
    // Not paid (yet). Don't fail the order permanently — the webhook may still
    // confirm it. Surface a clear, retryable message.
    throw new ValidationError('Payment not completed yet. If you paid, it will reflect shortly.');
  }

  return activateGuarded(orderId, status.cfPaymentId);
}

/**
 * Webhook path (PAYMENT_SUCCESS): activate idempotently. The webhook signature
 * is verified by the route before calling this. Safe to run after the confirm
 * path already activated. (Req 6.6)
 */
export async function activateFromWebhook(orderId: string, paymentId?: string): Promise<ActivationResult> {
  const order = await prisma.packOrder.findUnique({ where: { gatewayOrderId: orderId } });
  if (!order) {
    logger.warn({ orderId }, 'Webhook for unknown pack order — ignoring');
    return { activated: false, credits: 0 };
  }
  return activateGuarded(orderId, paymentId);
}

/**
 * The single guarded activation used by both paths. Re-reads the order inside a
 * transaction, proceeds only if not already activated, creates the CreditPack,
 * and stamps status='paid' + activatedPackId. (Req 6.6 idempotency)
 */
async function activateGuarded(orderId: string, paymentId?: string): Promise<ActivationResult> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{ id: string; driver_id: string; pack_key: string; credits: number; activated_pack_id: string | null }>
    >`
      SELECT id, driver_id, pack_key, credits, activated_pack_id
      FROM pack_orders
      WHERE gateway_order_id = ${orderId}
      FOR UPDATE
    `;
    if (rows.length === 0) return { activated: false, credits: 0 };
    const order = rows[0];

    if (order.activated_pack_id) {
      // Already activated by the other path — no-op.
      return { activated: false, packId: order.activated_pack_id, credits: order.credits };
    }

    const pack = await activatePurchasedPack(
      tx,
      order.driver_id,
      order.pack_key as PackKey,
      order.id,
    );

    await tx.$executeRaw`
      UPDATE pack_orders
      SET status = 'paid',
          activated_pack_id = ${pack.id},
          gateway_payment_id = ${paymentId ?? null},
          paid_at = NOW()
      WHERE id = ${order.id}
    `;

    return { activated: true, packId: pack.id, credits: order.credits };
  });
}
