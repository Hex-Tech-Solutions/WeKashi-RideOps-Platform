import { describe, it, expect } from 'vitest';
import { noShowOpensAt } from '../src/services/ridePax.service';

const MIN = 60_000;
// 2026-11-20 08:30 IST login shift; the employee's pickup is 06:30 IST.
const ist = (s: string) => new Date(`${s}+05:30`);
const SHIFT = ist('2026-11-20T08:30:00');

describe('noShowOpensAt', () => {
  it('is null until the driver has confirmed arrival', () => {
    expect(noShowOpensAt(null, SHIFT, 'login', '06:30')).toBeNull();
  });

  it('early arrival: counts 5 minutes from the scheduled pickup time', () => {
    const arrived = ist('2026-11-20T06:10:00');
    expect(noShowOpensAt(arrived, SHIFT, 'login', '06:30')!.getTime()).toBe(ist('2026-11-20T06:35:00').getTime());
  });

  it('late arrival: counts 5 minutes from the arrival', () => {
    const arrived = ist('2026-11-20T06:42:00');
    expect(noShowOpensAt(arrived, SHIFT, 'login', '06:30')!.getTime()).toBe(arrived.getTime() + 5 * MIN);
  });

  it('works for logout pickups after the shift end', () => {
    const end = ist('2026-11-20T18:00:00');
    const arrived = ist('2026-11-20T17:50:00');
    expect(noShowOpensAt(arrived, end, 'logout', '18:20')!.getTime()).toBe(ist('2026-11-20T18:25:00').getTime());
  });

  it('live rides without a scheduled time: 5 minutes after arrival', () => {
    const arrived = ist('2026-11-20T06:10:00');
    expect(noShowOpensAt(arrived, null, 'login', null)!.getTime()).toBe(arrived.getTime() + 5 * MIN);
    expect(noShowOpensAt(arrived, SHIFT, 'login', null)!.getTime()).toBe(arrived.getTime() + 5 * MIN);
  });
});
