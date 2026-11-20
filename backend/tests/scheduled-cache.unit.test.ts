import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const { store, fail } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  fail: { on: false },
}));

vi.mock('../src/lib/redis', () => ({
  redis: {
    get: vi.fn(async (k: string) => {
      if (fail.on) throw new Error('redis down');
      return store.get(k) ?? null;
    }),
    set: vi.fn(async (k: string, v: string) => {
      if (fail.on) throw new Error('redis down');
      store.set(k, v);
      return 'OK';
    }),
    scan: vi.fn(async (_cursor: string, _m: string, pattern: string) => {
      if (fail.on) throw new Error('redis down');
      const prefix = pattern.replace(/\*$/, '');
      return ['0', [...store.keys()].filter((k) => k.startsWith(prefix))];
    }),
    del: vi.fn(async (...keys: string[]) => {
      keys.forEach((k) => store.delete(k));
      return keys.length;
    }),
  },
}));
vi.mock('../src/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  cachedScheduledList,
  invalidateScheduledCache,
  scheduledCacheKey,
} from '../src/lib/scheduledCache';

const vehicleType = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(''),
  fc.constantFrom('sedan', 'suv', 'hatchback', 'tempo'),
  fc.string({ maxLength: 12 }),
);

// Shape similar to a scheduled ride row: dates, nullable numbers, nested objects.
const rideRow = fc.record({
  id: fc.uuid(),
  scheduledFor: fc.date({ min: new Date('2026-01-01'), max: new Date('2027-12-31'), noInvalidDate: true }),
  price: fc.option(fc.double({ noNaN: true, noDefaultInfinity: true, min: 0, max: 10_000 }), { nil: null }),
  vehicleType: fc.option(fc.constantFrom('sedan', 'suv'), { nil: null }),
  firstPickupTime: fc.option(fc.stringMatching(/^[0-2][0-9]:[0-5][0-9]$/), { nil: null }),
  supervisor: fc.record({ fullName: fc.string({ maxLength: 20 }), org: fc.option(fc.string(), { nil: null }) }),
  rideEmployees: fc.array(fc.record({ employee: fc.record({ name: fc.string({ maxLength: 15 }) }) }), { maxLength: 4 }),
});

describe('scheduled-rides cache', () => {
  beforeEach(() => {
    store.clear();
    fail.on = false;
  });

  // Feature: driver-app-load-reduction, Property 5: Scheduled cache round-trip equals a fresh read
  it('returns the same body on a hit as on a fresh build', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(rideRow, { maxLength: 8 }), vehicleType, async (list, vt) => {
        store.clear();
        const body = JSON.parse(JSON.stringify(list));

        const miss = await cachedScheduledList(vt, async () => list);
        let rebuilt = false;
        const hit = await cachedScheduledList(vt, async () => {
          rebuilt = true;
          return [];
        });

        expect(miss).toEqual(body);
        expect(hit).toEqual(body);
        expect(rebuilt).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  // Feature: driver-app-load-reduction, Property 6: Cache keys stay outside scanned prefixes
  it('only uses the cache:scheduled: prefix', () => {
    fc.assert(
      fc.property(vehicleType, (vt) => {
        const key = scheduledCacheKey(vt);
        expect(key.startsWith('cache:scheduled:')).toBe(true);
        for (const p of ['dpos:', 'trail:', 'activeride:']) expect(key.startsWith(p)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('falls back to the database when Redis is down', async () => {
    fail.on = true;
    const list = [{ id: 'r1', scheduledFor: new Date('2026-12-01T10:00:00Z') }];
    await expect(cachedScheduledList('sedan', async () => list)).resolves.toEqual(JSON.parse(JSON.stringify(list)));
    await expect(invalidateScheduledCache()).resolves.toBeUndefined();
  });

  it('invalidation clears cached lists and leaves other keys alone', async () => {
    store.set('dpos:driver-1', '{"lat":1,"lng":2}');
    store.set('activeride:driver-1', '0');
    await cachedScheduledList('sedan', async () => [{ id: 'a' }]);
    await cachedScheduledList(null, async () => [{ id: 'b' }]);

    await invalidateScheduledCache();

    expect([...store.keys()].sort()).toEqual(['activeride:driver-1', 'dpos:driver-1']);
    const fresh = await cachedScheduledList('sedan', async () => [{ id: 'c' }]);
    expect(fresh).toEqual([{ id: 'c' }]);
  });
});