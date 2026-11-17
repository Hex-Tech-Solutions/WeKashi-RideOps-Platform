import { describe, it, expect } from 'vitest';
import { tripRangeBounds } from '../src/services/driverTrips.service';

// 14 Nov 2026, 10:00 IST
const NOW = new Date('2026-11-14T04:30:00Z');

describe('Recent trips periods (#16, IST)', () => {
  it('today = IST midnight to the next IST midnight', () => {
    const { from, to } = tripRangeBounds('today', NOW);
    expect(from.toISOString()).toBe('2026-11-13T18:30:00.000Z'); // 14 Nov 00:00 IST
    expect(to.toISOString()).toBe('2026-11-14T18:30:00.000Z');
  });

  it('last 7 days = 8 Nov 00:00 to 15 Nov 00:00 IST (today included)', () => {
    const { from, to } = tripRangeBounds('last7', NOW);
    expect(from.toISOString()).toBe('2026-11-07T18:30:00.000Z');
    expect(to.toISOString()).toBe('2026-11-14T18:30:00.000Z');
  });

  it('8–14 days ago = the 7 days before that, no overlap', () => {
    const { from, to } = tripRangeBounds('prev7', NOW);
    expect(from.toISOString()).toBe('2026-10-31T18:30:00.000Z'); // 1 Nov 00:00 IST
    expect(to.toISOString()).toBe(tripRangeBounds('last7', NOW).from.toISOString());
  });

  it('uses the IST date just after midnight IST', () => {
    const justAfter = new Date('2026-11-13T18:31:00Z'); // 14 Nov 00:01 IST
    expect(tripRangeBounds('today', justAfter).from.toISOString()).toBe('2026-11-13T18:30:00.000Z');
  });
});
