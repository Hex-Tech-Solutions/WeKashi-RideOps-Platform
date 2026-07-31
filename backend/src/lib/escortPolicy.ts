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
 * orderedGenders: the submitted employeeIds order mapped to genders.
 * Falls back to all-passenger list when not provided.
 *
 * Outside 07:00–19:00 → never an escort.
 * rideTime = null      → window unknown, skip window check.
 */

export const ESCORT_WINDOW_START_HOUR = 7;
export const ESCORT_WINDOW_END_HOUR   = 19;

export interface EscortPassenger {
  gender: string;
}

export interface EscortPolicyInput {
  passengers:     EscortPassenger[];
  /** Global fallback time when a stop has no individual time set. */
  rideTime:       Date | null;
  rideType:       string;
  /** Genders in final route order (seq 0, 1, 2 …). */
  orderedGenders?: string[];
  /** Per-stop times in route order: "HH:MM" or null. Same length as orderedGenders. */
  orderedTimes?:  (string | null)[];
}

export interface EscortPolicyResult {
  required: boolean;
  reason?:  string;
}

function isFemale(g: string): boolean {
  const s = (g ?? '').trim().toLowerCase();
  return s === 'f' || s === 'female';
}

function inRestrictedWindow(rideTime: Date | null): boolean {
  if (!rideTime) return false;
  const h = rideTime.getHours() + rideTime.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

function parseHHMM(hhmm: string | null, fallback: Date | null): Date | null {
  if (hhmm) {
    const [hh, mm] = hhmm.split(':').map(Number);
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d;
  }
  return fallback;
}

export function evaluateEscortPolicy(input: EscortPolicyInput): EscortPolicyResult {
  const { passengers, rideTime, rideType, orderedGenders, orderedTimes } = input;
  if (!passengers.length) return { required: false };

  const hasFemale = passengers.some((p) => isFemale(p.gender));
  if (!hasFemale) return { required: false };

  const ordered = orderedGenders?.length
    ? orderedGenders
    : passengers.map((p) => p.gender);

  const times: (string | null)[] = orderedTimes?.length ? orderedTimes : ordered.map(() => null);

  const isLogin = rideType !== 'logout';
  const first   = { gender: ordered[0], time: times[0] };
  const last    = { gender: ordered[ordered.length - 1], time: times[times.length - 1] };

  // Login: first stop is dangerous if female and in window
  if (isLogin && isFemale(first.gender)) {
    const t = parseHHMM(first.time, rideTime);
    if (inRestrictedWindow(t)) {
      return {
        required: true,
        reason: `First pickup is female at ${first.time ?? 'unknown time'} — alone with driver during restricted hours (19:00–07:00)`,
      };
    }
  }

  // Last stop is dangerous (both login and logout) if female and in window
  if (isFemale(last.gender)) {
    const t = parseHHMM(last.time, rideTime);
    if (inRestrictedWindow(t)) {
      return {
        required: true,
        reason: `Last stop is female at ${last.time ?? 'unknown time'} — alone with driver during restricted hours (19:00–07:00)`,
      };
    }
  }

  return { required: false };
}
