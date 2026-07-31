/**
 * Women's Safety Escort Policy
 *
 * Escort required when a female is in a dangerous position AND the stop time
 * is in the restricted window (19:00–07:00).
 *
 * Dangerous positions:
 *   LOGIN/SCHEDULED → seq=0 (first pickup): female alone with driver before others board.
 *   LOGOUT          → last stop: female alone with driver after everyone else exits.
 *
 * Time resolution (per dangerous stop):
 *   1. Use the per-stop time if set (orderedTimes[index]).
 *   2. Fall back to the global rideTime.
 *   3. If NEITHER is set → assume worst case → require escort.
 */

export const ESCORT_WINDOW_START_HOUR = 7;
export const ESCORT_WINDOW_END_HOUR   = 19;

export interface EscortPassenger { gender: string; }

export interface EscortPolicyInput {
  passengers:      EscortPassenger[];
  rideTime:        Date | null;
  rideType:        string;
  orderedGenders?: string[];
  orderedTimes?:   (string | null)[];
}

export interface EscortPolicyResult {
  required: boolean;
  reason?:  string;
}

export function isFemale(g: string): boolean {
  const s = (g ?? '').trim().toLowerCase();
  return s === 'f' || s === 'female';
}

function inRestrictedWindow(rideTime: Date | null): boolean {
  if (!rideTime) return false;
  const h = rideTime.getHours() + rideTime.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

function resolveTime(hhmm: string | null | undefined, fallback: Date | null): Date | null {
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

  const ordered = orderedGenders?.length ? orderedGenders : passengers.map((p) => p.gender);
  const times: (string | null)[] = orderedTimes?.length ? orderedTimes : ordered.map(() => null);

  const isLogout = rideType === 'logout';

  const checkPosition = (gender: string, stopTime: string | null, label: string): EscortPolicyResult | null => {
    if (!isFemale(gender)) return null;
    const t = resolveTime(stopTime, rideTime);
    if (!t) {
      // Time completely unknown — assume worst case
      return {
        required: true,
        reason: `${label} is female and no pickup time is set — cannot verify safety window. Set a stop time or add an escort.`,
      };
    }
    if (inRestrictedWindow(t)) {
      return {
        required: true,
        reason: `${label} is female at ${stopTime ?? t.toTimeString().slice(0, 5)} — alone with driver during restricted hours (19:00–07:00)`,
      };
    }
    return null;
  };

  if (isLogout) {
    const result = checkPosition(ordered[ordered.length - 1], times[times.length - 1], 'Last drop');
    if (result) return result;
  } else {
    // login or scheduled
    const result = checkPosition(ordered[0], times[0], 'First pickup');
    if (result) return result;
  }

  return { required: false };
}
