/**
 * Women's Safety Escort Policy
 *
 * Escort required only when ride time is in restricted window (19:00–07:00)
 * AND a female is in a dangerous position in the final route:
 *
 *   LOGIN  → seq=0 (first pickup) is female.
 *            After seq=0 boards, every subsequent pickup enters an occupied cab — safe.
 *            Last login pickup is NOT dangerous.
 *
 *   LOGOUT → last stop is female (last drop, alone with driver after others exit).
 *            First logout stop is NOT dangerous — everyone boards at the office together.
 *
 * Time checked per stop using the supervisor's per-stop pickup time.
 * Falls back to the global shift time if a stop has no individual time set.
 * If neither is set, the window check is skipped (no escort triggered).
 */

export const ESCORT_WINDOW_START_HOUR = 7;   // before 07:00
export const ESCORT_WINDOW_END_HOUR   = 19;  // at or after 19:00

export interface EscortPassenger {
  gender: string;
}

export interface EscortStop {
  gender: string;
  stopTime: string | null; // HH:MM or null
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

  const isLogin = rideType !== 'logout';

  if (isLogin) {
    // LOGIN: only seq=0 is dangerous
    const first = stops[0];
    if (isFemale(first.gender)) {
      const t = resolveTime(first.stopTime, fallbackTime);
      if (inRestrictedWindow(t)) {
        return {
          required: true,
          reason: `First pickup is female at ${first.stopTime ?? (t ? t.toTimeString().slice(0,5) : 'unknown')} — she will be alone with the driver before others board (19:00–07:00)`,
        };
      }
    }
  } else {
    // LOGOUT: only last stop is dangerous
    const last = stops[stops.length - 1];
    if (isFemale(last.gender)) {
      const t = resolveTime(last.stopTime, fallbackTime);
      if (inRestrictedWindow(t)) {
        return {
          required: true,
          reason: `Last drop is female at ${last.stopTime ?? (t ? t.toTimeString().slice(0,5) : 'unknown')} — she will be alone with the driver after others exit (19:00–07:00)`,
        };
      }
    }
  }

  return { required: false };
}
