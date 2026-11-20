import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { httpLogLevel } from '../src/lib/httpLogLevel';

const QUIET = [
  '/health',
  '/api/driver/location',
  '/api/driver/offers',
  '/api/driver/rides',
  '/api/driver/scheduled',
  '/api/driver/credits',
  '/api/driver/stats',
  '/api/driver/rentals/available',
  '/api/driver/rentals/mine',
  '/api/issues',
];
// Near-misses must still be logged.
const OTHER = [
  '/',
  '/api/rides',
  '/api/driver/me',
  '/api/driver/locationx',
  '/api/driver/offers/extra',
  '/api/issues/abc/messages',
  '/api/supervisor/dashboard',
  '/healthz',
];

const queryString = fc
  .option(fc.stringMatching(/^[a-z0-9=&]{0,20}$/), { nil: undefined })
  .map((q) => (q === undefined ? '' : `?${q}`));

describe('httpLogLevel', () => {
  // Feature: driver-app-load-reduction, Property 4: Hot-route log suppression keeps every failure
  it('silences only successful quiet routes and always logs failures', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...QUIET, ...OTHER),
        queryString,
        fc.integer({ min: 100, max: 599 }),
        fc.boolean(),
        (path, query, status, hasErr) => {
          const level = httpLogLevel(path + query, status, hasErr ? new Error('boom') : undefined);
          if (hasErr || status >= 500) expect(level).toBe('error');
          else if (status >= 400) expect(level).toBe('warn');
          else expect(level).toBe(QUIET.includes(path) ? 'silent' : 'info');
        },
      ),
      { numRuns: 500 },
    );
  });
});