import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

const { del } = vi.hoisted(() => ({ del: vi.fn(async (..._keys: string[]) => 1) }));
vi.mock('../src/lib/redis', () => ({ redis: { del, get: vi.fn(), set: vi.fn() } }));
vi.mock('../src/lib/prisma', () => ({ prisma: {} }));
vi.mock('../src/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { invalidateDriverActiveRide, setDriverRidesNotifier } from '../src/lib/activeRideCache';

// Small pool so duplicates are common, plus random ids and empty values.
const idArg = fc.oneof(
  fc.constantFrom('d1', 'd2', 'd3'),
  fc.uuid(),
  fc.constant(null),
  fc.constant(undefined),
  fc.constant(''),
);

const sorted = (xs: string[]) => [...xs].sort();

describe('invalidateDriverActiveRide notifier', () => {
  beforeEach(() => {
    setDriverRidesNotifier(null);
    del.mockClear();
  });

  // Feature: driver-app-load-reduction, Property 2: Every invalidated driver is notified exactly once
  it('notifies each distinct non-empty driver id exactly once', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(idArg, { maxLength: 12 }), async (args) => {
        const calls: string[][] = [];
        setDriverRidesNotifier((ids) => calls.push(ids));
        await invalidateDriverActiveRide(...args);

        const expected = [...new Set(args.filter((a): a is string => !!a))];
        if (expected.length === 0) {
          expect(calls).toHaveLength(0);
        } else {
          expect(calls).toHaveLength(1);
          expect(new Set(calls[0]).size).toBe(calls[0].length);
          expect(sorted(calls[0])).toEqual(sorted(expected));
        }
      }),
      { numRuns: 300 },
    );
  });

  // Feature: driver-app-load-reduction, Property 3: Notifier failures never break ride flows
  it('still resolves and deletes the cache keys when the notifier throws', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(idArg, { maxLength: 12 }), async (args) => {
        del.mockClear();
        setDriverRidesNotifier(() => {
          throw new Error('socket down');
        });
        await expect(invalidateDriverActiveRide(...args)).resolves.toBeUndefined();

        const expected = [...new Set(args.filter((a): a is string => !!a))];
        if (expected.length === 0) {
          expect(del).not.toHaveBeenCalled();
        } else {
          expect(del).toHaveBeenCalledTimes(1);
          expect(sorted(del.mock.calls[0])).toEqual(sorted(expected.map((id) => `activeride:${id}`)));
        }
      }),
      { numRuns: 300 },
    );
  });
});