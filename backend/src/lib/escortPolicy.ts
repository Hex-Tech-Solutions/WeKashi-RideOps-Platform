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
 * orderedGenders + orderedTimes: genders and per-stop times in final route order.
 * Falls back to global rideTime if a stop has no individual time set.
 */

export const ESCORT_WINDOW_START_HOUR = 7;
export const ESCORT_WINDOW_END_HOUR   = 19;

export interface EscortPassenger {
  gender: string;
}

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

function isFemale(g: string): boolean {
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

  const isLogin = rideType !== 'logout';

  if (isLogin) {
    // LOGIN: only seq=0 is dangerous
    const firstGender = ordered[0];
    const firstTime   = times[0];
    if (isFemale(firstGender)) {
      const t = resolveTime(firstTime, rideTime);
      if (inRestrictedWindow(t)) {
        return {
          required: true,
          reason: `First pickup is female at ${firstTime ?? 'unknown time'} — alone with driver before others board (19:00–07:00)`,
        };
      }
    }
  } else {
    // LOGOUT: only last stop is dangerous
    const lastGender = ordered[ordered.length - 1];
    const lastTime   = times[times.length - 1];
    if (isFemale(lastGender)) {
      const t = resolveTime(lastTime, rideTime);
      if (inRestrictedWindow(t)) {
        return {
          required: true,
          reason: `Last drop is female at ${lastTime ?? 'unknown time'} — alone with driver after others exit (19:00–07:00)`,
        };
      }
    }
  }

  return { required: false };
}
