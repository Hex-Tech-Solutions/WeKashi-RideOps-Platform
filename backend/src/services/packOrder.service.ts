// Pack_Payment_Service — creates Razorpay orders for pack purchases and
// activates the pack once payment is verified. Activation is idempotent: the
// client confirm callback and the webhook both call the same guarded function,
// and PackOrder.activatedPackId ensures at most one CreditPack per order.

import { prisma } from '../lib/prisma';
import { PACK_CATALOG, PackKey, isPackKey } from '../lib/creditPacks';
import { createPackOrder, verifyPaymentSignature } from '../lib/razorpay';
import { activatePurchasedPack } from './creditPack.service';
import { ValidationError, NotFoundError } from '../types';
import { logger } from '../lib/logger';

export interface CreatedOrder {
  orderId: string;
  amount: number; // paise
  currency: string;
  keyId: string;
  packKey: PackKey;
  credits: number;
}

/**
 * Create a Razorpay order for the selected pack and persist a PackOrder row.
 * (Req 6.1, 6.5)
 */
export async function createOrder(driverId: string, packKey: string): Promise<CreatedOrder> {
  if (!isPackKey(packKey)) throw new ValidationError('Unknown pack');
  const def = PACK_CATALOG[packKey];

  const order = await createPackOrder(def.price, `pack_${packKey}_${driverId}`);

  await prisma.packOrder.create({
    data: {
      driverId,
      packKey,
      credits: def.credits,
      amount: def.price,
      razorpayOrderId: order.orderId,
      status: 'created',
    },
  });

  return {
    orderId: order.orderId,
    amount: order.amount,
    currency: order.currency,
    keyId: order.keyId,
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
 * Client-confirm path: verify the checkout signature, then activate the pack
 * idempotently. On invalid signature the order is marked failed and no credits
 * are added. (Req 6.2, 6.3, 6.4, 6.6)
 */
export async function activateFromPayment(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): Promise<ActivationResult> {
  const order = await prisma.packOrder.findUnique({
    where: { razorpayOrderId: params.orderId },
  });
  if (!order) throw new NotFoundError('Order not found');

  const valid = verifyPaymentSignature({
    orderId: params.orderId,
    paymentId: params.paymentId,
    signature: params.signature,
  });

  if (!valid) {
    await prisma.packOrder.update({
      where: { razorpayOrderId: params.orderId },
      data: { status: 'failed' },
    });
    throw new ValidationError('Payment signature verification failed');
  }

  return activateGuarded(params.orderId, params.paymentId);
}

/**
 * Webhook path (payment.captured): activate idempotently without a client
 * signature — the webhook signature is verified by the route before calling
 * this. Safe to run after the confirm path already activated. (Req 6.6)
 */
export async function activateFromWebhook(orderId: string, paymentId?: string): Promise<ActivationResult> {
  const order = await prisma.packOrder.findUnique({ where: { razorpayOrderId: orderId } });
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
    // Lock the order row to serialise concurrent confirm+webhook callers.
    const rows = await tx.$queryRaw<
      Array<{ id: string; driver_id: string; pack_key: string; credits: number; activated_pack_id: string | null }>
    >`
      SELECT id, driver_id, pack_key, credits, activated_pack_id
      FROM pack_orders
      WHERE razorpay_order_id = ${orderId}
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
          razorpay_payment_id = ${paymentId ?? null},
          paid_at = NOW()
      WHERE id = ${order.id}
    `;

    return { activated: true, packId: pack.id, credits: order.credits };
  });
}
