/**
 * Women's Safety Escort Policy
 *
 * Escort is required when the ride is in the restricted window (19:00–07:00)
 * AND a female passenger will be alone with the driver at a dangerous position.
 *
 * Dangerous positions:
 *   LOGIN  — seq=0 (first pickup, driver arrives alone)
 *   LOGOUT — last stop (last drop, everyone else has exited)
 *
 * The backend re-validates using the ACTUAL ordered employee IDs submitted by
 * the supervisor (after any manual reorder), fetching genders from DB.
 * Falls back to count-based check when orderedGenders is not provided.
 *
 * Outside 07:00–19:00 → never an escort.
 * rideTime = null      → window check skipped (time not set yet).
 */

export const ESCORT_WINDOW_START_HOUR = 7;   // before 07:00
export const ESCORT_WINDOW_END_HOUR   = 19;  // at or after 19:00

export interface EscortPassenger {
  gender: string;
}

export interface EscortPolicyInput {
  passengers: EscortPassenger[];
  rideTime: Date | null;
  rideType: string;
  /**
   * Genders in the ACTUAL final route order (seq 0, 1, 2 …).
   * When provided, the check uses real positions instead of just counts.
   */
  orderedGenders?: string[];
}

export interface EscortPolicyResult {
  required: boolean;
  reason?: string;
  reordered?: boolean;
}

function isFemale(gender: string): boolean {
  const g = (gender ?? '').trim().toLowerCase();
  return g === 'f' || g === 'female';
}

function inRestrictedWindow(rideTime: Date | null): boolean {
  if (!rideTime) return false;
  const h = rideTime.getHours() + rideTime.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

export function evaluateEscortPolicy(input: EscortPolicyInput): EscortPolicyResult {
  const { passengers, rideTime, rideType, orderedGenders } = input;
  if (!passengers.length) return { required: false };

  const femaleCount = passengers.filter((p) => isFemale(p.gender)).length;
  const maleCount   = passengers.length - femaleCount;

  if (femaleCount === 0) return { required: false };

  // Outside restricted window → no escort needed
  if (!inRestrictedWindow(rideTime)) {
    return { required: false, reordered: maleCount > 0 };
  }

  // ── Inside restricted window ──────────────────────────────────────────────

  // No male at all → escort required regardless of order
  if (maleCount === 0) {
    const reason = femaleCount === 1
      ? 'Single female travelling alone with driver during restricted hours (19:00–07:00)'
      : 'All passengers are female — no male buffer during restricted hours (19:00–07:00)';
    return { required: true, reason };
  }

  // ≥1 male — check actual route order if provided
  if (orderedGenders && orderedGenders.length > 0) {
    const isLogin = rideType !== 'logout';
    const first   = orderedGenders[0];
    const last    = orderedGenders[orderedGenders.length - 1];

    if (isLogin && isFemale(first)) {
      return {
        required: true,
        reason: 'First pickup is female — she will be alone with the driver before others board (restricted hours)',
      };
    }

    if (isFemale(last)) {
      return {
        required: true,
        reason: 'Last stop is female — she will be alone with the driver after others exit (restricted hours)',
      };
    }

    return { required: false, reordered: true };
  }

  // Count-based fallback: ≥1 male can buffer
  return { required: false, reordered: true };
}
