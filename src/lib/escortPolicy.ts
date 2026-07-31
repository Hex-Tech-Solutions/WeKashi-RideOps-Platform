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

/**
 * @param orderedStops  Final route order (seq 0, 1, 2 …) as gender strings.
 *                      Pass route.stops.map(s => s.gender) from geo.ts.
 * @param allPassengers All selected passengers (used for count-based fallback
 *                      when orderedStops is unavailable).
 */
export function evaluateEscortPolicy(
  allPassengers: EscortPassenger[],
  rideTime: Date | null,
  rideType: string = 'login',
  orderedStops: EscortPassenger[] = [],
): EscortPolicyResult {
  if (!allPassengers.length) return { required: false };

  const hasFemale = allPassengers.some((p) => isFemale(p.gender));
  if (!hasFemale) return { required: false };

  // Outside restricted window — never an escort
  if (!inRestrictedWindow(rideTime)) return { required: false };

  // ── In restricted window ──────────────────────────────────────────────────
  const stops = orderedStops.length ? orderedStops : allPassengers;
  const isLogin = rideType !== 'logout';
  const first   = stops[0];
  const last    = stops[stops.length - 1];

  // Login: first stop female = alone with driver on arrival
  if (isLogin && isFemale(first.gender)) {
    return {
      required: true,
      reason: 'First pickup is female — she will be alone with the driver during restricted hours (19:00–07:00)',
    };
  }

  // Both login and logout: last stop female = alone with driver at the end
  if (isFemale(last.gender)) {
    return {
      required: true,
      reason: 'Last stop is female — she will be alone with the driver during restricted hours (19:00–07:00)',
    };
  }

  return { required: false };
}
