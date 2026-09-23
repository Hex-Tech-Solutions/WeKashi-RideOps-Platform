// Cashfree Payment Gateway integration for credit-pack purchases.
//
// Flow (Option 1 — Cashfree collects pack money into the platform account):
//   1. Backend creates a Cashfree order  → returns payment_session_id.
//   2. Frontend opens Cashfree JS checkout with that session id.
//   3. Backend confirms the payment by FETCHING order status (== 'PAID').
//      Cashfree does not use a client-side HMAC signature like Razorpay; the
//      authoritative check is the server-side order status.
//   4. A webhook (PAYMENT_SUCCESS) triggers the same idempotent activation.
//
// Credentials (from env):
//   CASHFREE_APP_ID       client id  (x-client-id header)
//   CASHFREE_SECRET_KEY   secret     (x-client-secret header)
//   CASHFREE_ENV          'sandbox' | 'production'  (defaults to sandbox)
//   CASHFREE_WEBHOOK_SECRET  optional; used to verify webhook signatures

import crypto from 'crypto';
import axios from 'axios';
import { logger } from './logger';

const appId = process.env.CASHFREE_APP_ID ?? '';
const secretKey = process.env.CASHFREE_SECRET_KEY ?? '';
const env = (process.env.CASHFREE_ENV ?? 'sandbox').toLowerCase();
const webhookSecret = process.env.CASHFREE_WEBHOOK_SECRET ?? secretKey;

// Pin the API version the payloads below are written against.
const API_VERSION = '2023-08-01';

const BASE_URL = env === 'production'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

if (!appId || !secretKey) {
  logger.warn('CASHFREE_APP_ID / CASHFREE_SECRET_KEY not set — pack purchase will fail until configured');
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-version': API_VERSION,
    'x-client-id': appId,
    'x-client-secret': secretKey,
  };
}

function assertConfigured(): void {
  if (!appId || !secretKey) {
    throw new Error('Cashfree is not configured (CASHFREE_APP_ID / CASHFREE_SECRET_KEY missing)');
  }
}

export interface CashfreeOrder {
  orderId: string;         // our order_id echoed back
  cfOrderId: string;       // Cashfree's internal id
  paymentSessionId: string; // used by the frontend JS checkout
  amount: number;          // rupees
  currency: string;
  appId: string;           // returned so the frontend uses the matching env key
  env: string;             // 'sandbox' | 'production'
}

/**
 * Create a Cashfree order for a pack purchase. `orderId` is our own unique id
 * (stored on PackOrder) so status can be re-fetched idempotently.
 */
export async function createPackOrder(params: {
  orderId: string;
  amountRupees: number;
  customerId: string;
  customerPhone: string;
  returnUrl?: string;
  notifyUrl?: string;
}): Promise<CashfreeOrder> {
  assertConfigured();
  const body: Record<string, unknown> = {
    order_id: params.orderId,
    order_amount: Math.round(params.amountRupees * 100) / 100,
    order_currency: 'INR',
    customer_details: {
      customer_id: params.customerId,
      customer_phone: params.customerPhone || '9999999999',
    },
    order_note: 'RideOps ride-credit pack',
  };
  const meta: Record<string, string> = {};
  if (params.returnUrl) meta.return_url = params.returnUrl;
  if (params.notifyUrl) meta.notify_url = params.notifyUrl;
  if (Object.keys(meta).length) body.order_meta = meta;

  const res = await axios.post(`${BASE_URL}/orders`, body, { headers: headers() });
  const data = res.data as {
    order_id: string; cf_order_id: string | number; payment_session_id: string;
    order_amount: number; order_currency: string;
  };
  return {
    orderId: data.order_id,
    cfOrderId: String(data.cf_order_id),
    paymentSessionId: data.payment_session_id,
    amount: data.order_amount,
    currency: data.order_currency,
    appId,
    env,
  };
}

export interface CashfreeOrderStatus {
  orderId: string;
  status: string;      // ACTIVE | PAID | EXPIRED | TERMINATED | ...
  isPaid: boolean;
  cfPaymentId?: string;
}

/**
 * Authoritative payment check: fetch the order and read its status. An order is
 * settled only when order_status === 'PAID'.
 */
export async function getOrderStatus(orderId: string): Promise<CashfreeOrderStatus> {
  assertConfigured();
  const res = await axios.get(`${BASE_URL}/orders/${encodeURIComponent(orderId)}`, { headers: headers() });
  const data = res.data as { order_id: string; order_status: string };

  let cfPaymentId: string | undefined;
  if (data.order_status === 'PAID') {
    // Fetch the successful payment id for our records (best-effort).
    try {
      const payments = await axios.get(
        `${BASE_URL}/orders/${encodeURIComponent(orderId)}/payments`,
        { headers: headers() },
      );
      const list = payments.data as Array<{ cf_payment_id: string | number; payment_status: string }>;
      const ok = Array.isArray(list) ? list.find((p) => p.payment_status === 'SUCCESS') : undefined;
      if (ok) cfPaymentId = String(ok.cf_payment_id);
    } catch (err) {
      logger.warn({ err, orderId }, 'Could not fetch Cashfree payment id (non-fatal)');
    }
  }

  return {
    orderId: data.order_id,
    status: data.order_status,
    isPaid: data.order_status === 'PAID',
    cfPaymentId,
  };
}

/**
 * Verify a Cashfree webhook signature. Cashfree signs webhooks with
 * HMAC-SHA256 over `timestamp + rawBody`, base64-encoded, sent in the
 * `x-webhook-signature` header (with `x-webhook-timestamp`).
 */
export function verifyWebhookSignature(rawBody: string, signature: string, timestamp: string): boolean {
  if (!webhookSecret) return false;
  const payload = `${timestamp}${rawBody}`;
  const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
