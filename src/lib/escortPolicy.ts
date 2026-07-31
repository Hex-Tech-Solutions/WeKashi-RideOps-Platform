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
 *   1. Use the per-stop time if set.
 *   2. Fall back to the global shift/pickup time.
 *   3. If NEITHER is set → assume worst case → require escort if female is at risk position.
 *      (Better safe than sorry when time is unknown.)
 */

export const ESCORT_WINDOW_START_HOUR = 7;   // before 07:00
export const ESCORT_WINDOW_END_HOUR   = 19;  // at or after 19:00

export interface EscortPassenger { gender: string; }
export interface EscortStop      { gender: string; stopTime: string | null; }

export interface EscortPolicyResult {
  required: boolean;
  reason?: string;
}

export function isFemale(g: string): boolean {
  const s = (g ?? '').trim().toLowerCase();
  return s === 'f' || s === 'female';
}

export function inRestrictedWindow(rideTime: Date | null): boolean {
  if (!rideTime) return false;
  const h = rideTime.getHours() + rideTime.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

function resolveTime(stopTime: string | null, fallback: Date | null): Date | null {
  if (stopTime) {
    const [hh, mm] = stopTime.split(':').map(Number);
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d;
  }
  return fallback;
}

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

  const stops: EscortStop[] = stopsWithTimes.length
    ? stopsWithTimes
    : orderedStops.map((s) => ({ gender: s.gender, stopTime: null }));

  if (!stops.length) return { required: false };

  const isLogout = rideType === 'logout';

  const checkStop = (stop: EscortStop, label: string): EscortPolicyResult | null => {
    if (!isFemale(stop.gender)) return null;
    const t = resolveTime(stop.stopTime, fallbackTime);
    // If time is completely unknown, assume worst-case — require escort
    if (!t) {
      return {
        required: true,
        reason: `${label} is female and no pickup time is set — cannot verify safety window. Set a stop time or add an escort.`,
      };
    }
    if (inRestrictedWindow(t)) {
      return {
        required: true,
        reason: `${label} is female at ${stop.stopTime ?? t.toTimeString().slice(0, 5)} — she will be alone with the driver during restricted hours (19:00–07:00)`,
      };
    }
    return null;
  };

  if (isLogout) {
    // LOGOUT: only last stop dangerous
    const result = checkStop(stops[stops.length - 1], 'Last drop');
    if (result) return result;
  } else {
    // LOGIN / SCHEDULED: only seq=0 dangerous
    const result = checkStop(stops[0], 'First pickup');
    if (result) return result;
  }

  return { required: false };
}
