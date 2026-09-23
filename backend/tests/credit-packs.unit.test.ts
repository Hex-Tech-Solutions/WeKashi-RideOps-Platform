import { describe, it, expect } from 'vitest';
import {
  PACK_CATALOG,
  PACK_VALIDITY_DAYS,
  JOINING_BONUS_CREDITS,
  listPackCatalog,
  isPackKey,
  packExpiry,
} from '../src/lib/creditPacks';
import { buildUpiIntent } from '../src/lib/upiQr';
import { verifyWebhookSignature } from '../src/lib/cashfree';
import crypto from 'crypto';

// These are pure-logic tests — no database or network needed.

describe('pack catalog (Req 5)', () => {
  it('offers exactly three packs with the required prices and credits', () => {
    expect(PACK_CATALOG.p5).toEqual({ key: 'p5', credits: 5, price: 100 });
    expect(PACK_CATALOG.p10).toEqual({ key: 'p10', credits: 10, price: 159 });
    expect(PACK_CATALOG.p20).toEqual({ key: 'p20', credits: 20, price: 249 });
    expect(Object.keys(PACK_CATALOG)).toHaveLength(3);
  });

  it('gives every pack a 365-day validity and one joining-bonus credit', () => {
    expect(PACK_VALIDITY_DAYS).toBe(365);
    expect(JOINING_BONUS_CREDITS).toBe(1);
    for (const p of listPackCatalog()) {
      expect(p.validityDays).toBe(365);
    }
  });

  it('recognises valid pack keys', () => {
    expect(isPackKey('p5')).toBe(true);
    expect(isPackKey('p99')).toBe(false);
  });

  it('computes expiry 365 days after activation', () => {
    const activated = new Date('2026-01-01T00:00:00Z');
    const expires = packExpiry(activated);
    const days = (expires.getTime() - activated.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBe(365);
  });
});

describe('UPI intent (Req 14)', () => {
  it('builds a upi://pay intent addressed to the driver VPA for the amount', () => {
    const intent = buildUpiIntent({ vpa: 'driver@bank', payeeName: 'Test Driver', amount: 620, note: 'RideOps abcd1234' });
    expect(intent.startsWith('upi://pay?')).toBe(true);
    expect(intent).toContain('pa=driver%40bank');
    expect(intent).toContain('am=620.00');
    expect(intent).toContain('cu=INR');
    expect(intent).toContain('tn=RideOps+abcd1234');
  });
});

describe('Cashfree webhook signature verification (Req 6.6)', () => {
  // Cashfree signs HMAC-SHA256(timestamp + rawBody) with the webhook secret,
  // base64-encoded. verifyWebhookSignature uses the secret captured at import
  // (CASHFREE_WEBHOOK_SECRET, falling back to CASHFREE_SECRET_KEY).
  const secret = process.env.CASHFREE_WEBHOOK_SECRET ?? process.env.CASHFREE_SECRET_KEY ?? '';
  const rawBody = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_id":"o1"}}}';
  const ts = '1700000000';

  it('accepts a correctly computed signature', () => {
    const good = crypto.createHmac('sha256', secret).update(`${ts}${rawBody}`).digest('base64');
    expect(verifyWebhookSignature(rawBody, good, ts)).toBe(true);
  });

  it('rejects a wrong signature', () => {
    expect(verifyWebhookSignature(rawBody, 'not-a-valid-signature', ts)).toBe(false);
  });
});
