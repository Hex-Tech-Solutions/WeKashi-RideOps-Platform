// Razorpay integration surface for the subscription-payments feature.
//
// Two money flows use this module:
//   1. Driver buys a credit pack  → orders.create + signature verify (tracked
//      in the platform's Razorpay account).
//   2. Driver saves a payable UPI → VPA validation (returns the account-holder
//      name so a supervisor can pay the driver directly, off-platform).
//
// Credentials come from env: RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET, and
// RAZORPAY_WEBHOOK_SECRET for webhook signature verification.

import crypto from 'crypto';
import Razorpay from 'razorpay';
import axios from 'axios';
import { logger } from './logger';

const keyId = process.env.RAZORPAY_KEY_ID ?? '';
const keySecret = process.env.RAZORPAY_KEY_SECRET ?? '';
const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET ?? '';

if (!keyId || !keySecret) {
  // Non-fatal at import time so tests and non-payment routes still load; the
  // pack/UPI endpoints will surface a clear error if actually invoked.
  logger.warn('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — pack purchase and VPA validation will fail until configured');
}

// Construct the SDK client lazily. The Razorpay constructor throws when
// key_id is empty, so building it at module load would crash the whole API on
// boot whenever the keys aren't configured yet. Building it on first use keeps
// the server bootable and surfaces a clean error only to the pack endpoints.
let client: Razorpay | null = null;
function getClient(): Razorpay {
  if (!keyId || !keySecret) {
    throw new Error('Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing)');
  }
  if (!client) {
    client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return client;
}

export interface PackOrder {
  orderId: string;
  amount: number; // paise
  currency: string;
  keyId: string;
}

/**
 * Create a Razorpay order for a pack purchase in the platform account.
 * `amountRupees` is the pack price; Razorpay works in paise.
 */
export async function createPackOrder(amountRupees: number, receipt: string): Promise<PackOrder> {
  const order = await getClient().orders.create({
    amount: Math.round(amountRupees * 100),
    currency: 'INR',
    receipt,
    payment_capture: true,
  });
  return {
    orderId: order.id,
    amount: Number(order.amount),
    currency: order.currency,
    keyId,
  };
}

/**
 * Verify the checkout callback signature: HMAC-SHA256(orderId|paymentId, secret).
 * Returns true only for an authentic Razorpay signature.
 */
export function verifyPaymentSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${params.orderId}|${params.paymentId}`)
    .digest('hex');
  return timingSafeEqualHex(expected, params.signature);
}

/**
 * Verify a Razorpay webhook payload signature against RAZORPAY_WEBHOOK_SECRET.
 * `rawBody` must be the exact bytes Razorpay sent (verify before JSON parsing).
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  if (!webhookSecret) return false;
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return timingSafeEqualHex(expected, signature);
}

export interface VpaValidationResult {
  valid: boolean;
  customerName?: string;
}

/**
 * Validate a UPI VPA via Razorpay's VPA-validation REST endpoint.
 * On success returns the registered account-holder name.
 */
export async function validateVpa(vpa: string): Promise<VpaValidationResult> {
  try {
    const res = await axios.post(
      'https://api.razorpay.com/v1/payments/validate/vpa',
      { vpa },
      { auth: { username: keyId, password: keySecret } },
    );
    const data = res.data as { success?: boolean; customer_name?: string };
    if (data.success) {
      return { valid: true, customerName: data.customer_name };
    }
    logger.warn({ vpa, data }, 'VPA validation returned non-success');
    return { valid: false };
  } catch (err) {
    // Surface Razorpay's actual HTTP status + error description so we can tell
    // a genuinely-invalid VPA apart from an auth / feature-not-enabled error.
    const ax = err as { response?: { status?: number; data?: unknown }; message?: string };
    logger.warn(
      { vpa, status: ax.response?.status, body: ax.response?.data, message: ax.message },
      'VPA validation request failed',
    );
    return { valid: false };
  }
}

/** Constant-time hex string comparison that tolerates length mismatch. */
function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
