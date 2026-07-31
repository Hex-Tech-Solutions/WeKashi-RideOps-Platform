/**
 * Women's Safety Escort Policy
 *
 * Escort is ONLY required when the ride is in the restricted time window
 * (19:00–07:00) AND a female passenger cannot be buffered by a male.
 *
 * Outside the window → never an escort, regardless of gender mix.
 *
 * LOGIN (individual pickups):
 *   Reorder puts a male at seq=0. Safe as long as ≥1 male exists.
 *   Escort required in window when: no male exists.
 *
 * LOGOUT (all board at office, drop individually):
 *   Reorder drops females first, males last. Safe as long as ≥1 male exists.
 *   Escort required in window when: no male exists.
 *
 * Time window: 19:00 (inclusive) to 07:00 (exclusive next day).
 * rideTime = null → window check skipped (supervisor hasn't set a time yet).
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
  const { passengers, rideTime } = input;
  if (!passengers.length) return { required: false };

  const femaleCount = passengers.filter((p) => isFemale(p.gender)).length;
  const maleCount   = passengers.length - femaleCount;

  // No females → nothing to protect
  if (femaleCount === 0) return { required: false };

  // Outside restricted window → no escort ever needed
  if (!inRestrictedWindow(rideTime)) {
    return { required: false, reordered: maleCount > 0 };
  }

  // ── Inside restricted window (19:00–07:00) ────────────────────────────────

  // No male → cannot buffer → escort required
  if (maleCount === 0) {
    const reason = femaleCount === 1
      ? 'Single female travelling alone with driver during restricted hours (19:00–07:00)'
      : 'All passengers are female — no male buffer during restricted hours (19:00–07:00)';
    return { required: true, reason };
  }

  // ≥1 male → reorder handles it
  return { required: false, reordered: true };
}
