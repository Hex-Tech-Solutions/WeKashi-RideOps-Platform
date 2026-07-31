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
 * The policy checks the ACTUAL final route order (after auto-reorder AND any
 * manual drag-reorder by the supervisor), not just passenger counts.
 * If orderedStops is not provided, falls back to count-based check.
 *
 * Outside 07:00–19:00 → never an escort.
 * rideTime = null      → window check skipped (time not set yet).
 */

export const ESCORT_WINDOW_START_HOUR = 7;   // before 07:00
export const ESCORT_WINDOW_END_HOUR   = 19;  // at or after 19:00

export interface EscortPassenger {
  gender: string;
}

export interface EscortPolicyResult {
  required: boolean;
  reason?: string;
  reordered: boolean;
}

function isFemale(gender: string): boolean {
  const g = (gender ?? '').trim().toLowerCase();
  return g === 'f' || g === 'female';
}

export function inRestrictedWindow(rideTime: Date | null): boolean {
  if (!rideTime) return false;
  const h = rideTime.getHours() + rideTime.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

export function evaluateEscortPolicy(
  passengers: EscortPassenger[],
  rideTime: Date | null,
  rideType: string = 'login',
  /** The actual ordered stops after reorder + any manual drag changes. */
  orderedStops?: EscortPassenger[],
): EscortPolicyResult {
  if (!passengers.length) return { required: false, reordered: false };

  const femaleCount = passengers.filter((p) => isFemale(p.gender)).length;
  const maleCount   = passengers.length - femaleCount;

  // No females → nothing to protect
  if (femaleCount === 0) return { required: false, reordered: false };

  // Outside restricted window → no escort needed; route still reordered for good practice
  if (!inRestrictedWindow(rideTime)) {
    return { required: false, reordered: maleCount > 0 };
  }

  // ── Inside restricted window (19:00–07:00) ────────────────────────────────

  // No male at all → cannot buffer → escort required regardless of order
  if (maleCount === 0) {
    const reason = femaleCount === 1
      ? 'Single female travelling alone with driver during restricted hours (19:00–07:00)'
      : 'All passengers are female — no male buffer during restricted hours (19:00–07:00)';
    return { required: true, reordered: false, reason };
  }

  // ≥1 male exists — check the ACTUAL order if available
  if (orderedStops && orderedStops.length > 0) {
    const isLogin  = rideType !== 'logout';
    const first = orderedStops[0];
    const last  = orderedStops[orderedStops.length - 1];

    if (isLogin && isFemale(first.gender)) {
      return {
        required: true,
        reordered: false,
        reason: 'First pickup is female — she will be alone with the driver before others board (restricted hours)',
      };
    }

    if (isFemale(last.gender)) {
      return {
        required: true,
        reordered: false,
        reason: 'Last stop is female — she will be alone with the driver after others exit (restricted hours)',
      };
    }

    // Route order is safe
    return { required: false, reordered: true };
  }

  // No ordered stops provided — fall back to count-based: ≥1 male can buffer
  return { required: false, reordered: true };
}
