/**
 * Women's Safety Escort Policy
 *
 * Simple rule: escort required when ALL of these are true:
 *   1. Ride time is in restricted window: 19:00–07:00
 *   2. At least one female passenger is present
 *   3. The final route has a female in a dangerous position:
 *        LOGIN  → first stop is female (alone with driver before anyone boards)
 *        LOGOUT → last stop is female (alone with driver after everyone exits)
 *
 * The auto-reorder in geo.ts tries to avoid dangerous positions.
 * If the supervisor manually changes the route and puts a female at risk,
 * the policy fires on that final order too.
 *
 * Outside 07:00–19:00 → never an escort.
 * rideTime = null      → window unknown, skip window check.
 */

export const ESCORT_WINDOW_START_HOUR = 7;   // before 07:00
export const ESCORT_WINDOW_END_HOUR   = 19;  // at or after 19:00

export interface EscortPassenger {
  gender: string;
}

export interface EscortPolicyResult {
  required: boolean;
  reason?: string;
}

function isFemale(g: string): boolean {
  const s = (g ?? '').trim().toLowerCase();
  return s === 'f' || s === 'female';
}

export function inRestrictedWindow(rideTime: Date | null): boolean {
  if (!rideTime) return false;
  const h = rideTime.getHours() + rideTime.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

export interface EscortStop {
  gender: string;
  /** HH:MM pickup/drop time for this specific stop. null = not set. */
  stopTime: string | null;
}

/**
 * @param stops         Final route order with gender + per-stop time.
 * @param fallbackTime  Global shift/pickup time used when a stop has no individual time.
 * @param rideType      'login' | 'logout'
 */
export function evaluateEscortPolicy(
  allPassengers: EscortPassenger[],
  fallbackTime: Date | null,
  rideType: string = 'login',
  orderedStops: EscortPassenger[] = [],
  stopsWithTimes: EscortStop[] = [],
): EscortPolicyResult {
  if (!allPassengers.length) return { required: false };

  const hasFemale = allPassengers.some((p) => isFemale(p.gender));
  if (!hasFemale) return { required: false };

  // ── Determine the effective time for each dangerous position ─────────────
  // Use per-stop time when available, fall back to global time.
  const stops = stopsWithTimes.length ? stopsWithTimes : orderedStops.map((s) => ({ gender: s.gender, stopTime: null }));
  const isLogin = rideType !== 'logout';
  const first   = stops[0];
  const last    = stops[stops.length - 1];

  function stopRideTime(stop: EscortStop): Date | null {
    if (stop.stopTime) {
      const [hh, mm] = stop.stopTime.split(':').map(Number);
      const d = new Date();
      d.setHours(hh, mm, 0, 0);
      return d;
    }
    return fallbackTime;
  }

  // Login: first stop is dangerous
  if (isLogin && isFemale(first.gender)) {
    const t = stopRideTime(first);
    if (inRestrictedWindow(t)) {
      return {
        required: true,
        reason: `First pickup (${first.gender === 'F' || first.gender === 'f' ? 'female' : first.gender}) is at ${first.stopTime ?? 'unknown time'} — she will be alone with the driver during restricted hours (19:00–07:00)`,
      };
    }
  }

  // Both login and logout: last stop is dangerous
  if (isFemale(last.gender)) {
    const t = stopRideTime(last);
    if (inRestrictedWindow(t)) {
      return {
        required: true,
        reason: `Last stop (female) is at ${last.stopTime ?? 'unknown time'} — she will be alone with the driver during restricted hours (19:00–07:00)`,
      };
    }
  }

  // Also check: if any female stop has a restricted-window time and she'd be
  // alone (no other passenger in the cab at that moment).
  // For login: first stop only (seq=0).
  // For logout: last stop only (everyone else has exited).
  // Both already covered above.

  return { required: false };
}
