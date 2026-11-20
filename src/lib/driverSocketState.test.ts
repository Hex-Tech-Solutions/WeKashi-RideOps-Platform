import { describe, it, expect, afterEach } from "vitest";
import fc from "fast-check";
import {
  offersPollInterval,
  setDriverSocketState,
  getDriverSocketState,
  OFFERS_POLL_CONNECTED_MS,
  OFFERS_POLL_DISCONNECTED_MS,
  isDriverDormant,
  driverPollInterval,
  rideKeepsDriverBusy,
  type DriverSocketState,
} from "./driverSocketState";

const STATES: DriverSocketState[] = ["off", "connected", "disconnected"];

describe("offersPollInterval", () => {
  afterEach(() => setDriverSocketState("off"));

  // Feature: driver-app-load-reduction, Property 1: Offers poll fast whenever the socket is down
  it("polls fast (<= 8 s) exactly when an online driver's socket is down", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...STATES), { minLength: 1, maxLength: 20 }), (seq) => {
        for (const s of seq) setDriverSocketState(s);
        const current = getDriverSocketState();
        expect(current).toBe(seq[seq.length - 1]);

        const ms = offersPollInterval(current);
        if (current === "disconnected") {
          expect(ms).toBe(OFFERS_POLL_DISCONNECTED_MS);
          expect(ms).toBeLessThanOrEqual(8_000);
        } else {
          expect(ms).toBe(OFFERS_POLL_CONNECTED_MS);
        }
      }),
      { numRuns: 300 },
    );
  });
});
describe("dormant mode (offline with no work in hand)", () => {
  const H = 60 * 60 * 1000;
  const NOW = Date.parse("2026-11-21T10:00:00Z");

  it("never polls while dormant and always polls otherwise", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STATES),
        fc.boolean(),
        fc.integer({ min: 1_000, max: 120_000 }),
        (s, busy, ms) => {
          const dormant = isDriverDormant(s, busy);
          expect(dormant).toBe(s === "off" && !busy);
          expect(driverPollInterval(ms, dormant)).toBe(dormant ? false : ms);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("counts only rides in progress or due within 2 hours as work in hand", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("broadcasting", "assigned", "in_progress", "completed", "cancelled", "expired", "scheduled"),
        fc.option(fc.integer({ min: -5 * H, max: 48 * H }), { nil: null }),
        (status, offset) => {
          const scheduledFor = offset === null ? null : new Date(NOW + offset).toISOString();
          const busy = rideKeepsDriverBusy({ status, scheduledFor }, NOW);
          const expected =
            status === "in_progress" || (status === "assigned" && (offset === null || offset <= 2 * H));
          expect(busy).toBe(expected);
        },
      ),
      { numRuns: 500 },
    );
  });
});