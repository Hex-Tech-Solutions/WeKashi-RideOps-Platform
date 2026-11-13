import { describe, it, expect } from 'vitest';
import {
  normalizeIndianMobile, normalizeDl, normalizeAadhaar, maskAadhaar, isMaskedAadhaar,
  hashAadhaar, normalizeVpa,
} from '../src/lib/identity';

describe('identity normalisation', () => {
  it('canonicalises every accepted phone format to +91XXXXXXXXXX', () => {
    // '+9741194444' is the same number typed with a stray "+" (seen in real data).
    for (const input of ['9741194444', '919741194444', '+919741194444', '+91 97411 94444', '097411-94444', '+9741194444']) {
      expect(normalizeIndianMobile(input)).toBe('+919741194444');
    }
  });

  it('rejects numbers that are not Indian mobiles', () => {
    for (const input of ['', '12345', '5741194444', '97411944441', '+14155552671']) {
      expect(normalizeIndianMobile(input)).toBeNull();
    }
  });

  it('normalises DL and VPA', () => {
    expect(normalizeDl('ka-05 20231234567')).toBe('KA0520231234567');
    expect(normalizeVpa('  Name@OkAxis ')).toBe('name@okaxis');
  });

  it('handles Aadhaar: 12 digits, masked display, stable keyed hash', () => {
    expect(normalizeAadhaar('4747 8996 3578')).toBe('474789963578');
    expect(normalizeAadhaar('12345')).toBeNull();
    expect(maskAadhaar('474789963578')).toBe('XXXX XXXX 3578');
    expect(isMaskedAadhaar('XXXX XXXX 3578')).toBe(true);
    expect(isMaskedAadhaar('474789963578')).toBe(false);
    const h = hashAadhaar('474789963578');
    expect(h).toHaveLength(64);
    expect(hashAadhaar('474789963578')).toBe(h);       // same input, same hash
    expect(hashAadhaar('474789963579')).not.toBe(h);   // different input
    expect(h).not.toContain('474789963578');           // never the plain number
  });
});
