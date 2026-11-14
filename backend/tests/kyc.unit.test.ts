import { describe, it, expect } from 'vitest';
import { computeKycStatus, type KycDoc } from '../src/services/kyc.service';
import { REQUIRED_DOC_TYPES } from '../src/lib/documentTypes';

const NOW = new Date('2026-11-14T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 24 * 60 * 60 * 1000);

/** One verified, unexpired upload of every required type. */
function allVerified(): KycDoc[] {
  return REQUIRED_DOC_TYPES.map((type) => ({ type, status: 'verified', expiry: day(200), createdAt: day(-10) }));
}

describe('computeKycStatus', () => {
  it('is approved when every required type is verified and valid', () => {
    expect(computeKycStatus(allVerified(), NOW)).toBe('approved');
  });

  it('is pending while a required type has no reviewed upload', () => {
    const docs = allVerified().filter((d) => d.type !== 'insurance');
    docs.push({ type: 'insurance', status: 'pending', expiry: day(300), createdAt: day(-1) });
    expect(computeKycStatus(docs, NOW)).toBe('pending');
    expect(computeKycStatus([], NOW)).toBe('pending');
  });

  it('is rejected when the newest reviewed upload of a type is rejected', () => {
    const docs = allVerified();
    docs.push({ type: 'dl', status: 'rejected', expiry: day(300), createdAt: day(-1) });
    expect(computeKycStatus(docs, NOW)).toBe('rejected');
  });

  it('is expired when the current verified copy has expired', () => {
    const docs = allVerified().map((d) => (d.type === 'puc' ? { ...d, expiry: day(-1) } : d));
    expect(computeKycStatus(docs, NOW)).toBe('expired');
  });

  it('a pending renewal does not drop an approved driver', () => {
    const docs = allVerified().map((d) => (d.type === 'insurance' ? { ...d, expiry: day(10) } : d));
    docs.push({ type: 'insurance', status: 'pending', expiry: day(375), createdAt: day(-1) });
    expect(computeKycStatus(docs, NOW)).toBe('approved');
  });

  it('a verified renewal restores an expired driver, ignoring the old copy', () => {
    const docs = allVerified().map((d) => (d.type === 'dl' ? { ...d, expiry: day(-5) } : d));
    expect(computeKycStatus(docs, NOW)).toBe('expired');
    docs.push({ type: 'dl', status: 'verified', expiry: day(3650), createdAt: day(-1) });
    expect(computeKycStatus(docs, NOW)).toBe('approved');
  });

  it('a rejected upload followed by a verified one is approved', () => {
    const docs = allVerified().filter((d) => d.type !== 'rc');
    docs.push({ type: 'rc', status: 'rejected', expiry: null, createdAt: day(-5) });
    docs.push({ type: 'rc', status: 'verified', expiry: null, createdAt: day(-1) });
    expect(computeKycStatus(docs, NOW)).toBe('approved');
  });
});
