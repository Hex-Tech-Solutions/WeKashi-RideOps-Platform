/**
 * Women's Safety Escort Policy — frontend mirror of backend/src/lib/escortPolicy.ts
 *
 * Keep in sync with the backend version. This runs in the browser to give the
 * supervisor real-time feedback during booking (Steps 1-3 of Routes.tsx).
 *
 * STEP 1 — Auto-reorder (handled by optimizeStops in geo.ts):
 *   Female must not be seq=0 (first pickup) or last seq (last drop/pickup).
 *   The route optimizer already swaps the last stop. We also fix the first stop below.
 *
 * STEP 2 — Escort required when reorder cannot solve it:
 *   Case A: Only 1 female → alone with driver at some point regardless of order
 *   Case B: All female → no male buffer
 *   Case C: Restricted window + females > males (can't fill both end positions with males)
 */

export const ESCORT_WINDOW_START_HOUR = 7;   // before 07:00
export const ESCORT_WINDOW_END_HOUR   = 19;  // at or after 19:00

export interface EscortPassenger {
  gender: 'M' | 'F' | string;
}

export interface EscortPolicyResult {
  required: boolean;
  reason?: string;
  /** True when the route was reordered but escort is not needed — show info note. */
  reordered: boolean;
}

function isFemale(gender: string): boolean {
  const g = (gender ?? '').trim().toLowerCase();
  return g === 'f' || g === 'female';
}

export function inRestrictedWindow(rideTime: Date | null): boolean {
  const t = rideTime ?? new Date();
  const h = t.getHours() + t.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

export function evaluateEscortPolicy(
  passengers: EscortPassenger[],
  rideTime: Date | null,
): EscortPolicyResult {
  if (!passengers.length) return { required: false, reordered: false };

  const femaleCount = passengers.filter((p) => isFemale(p.gender)).length;
  const maleCount   = passengers.length - femaleCount;

  if (femaleCount === 0) return { required: false, reordered: false };

  // Case A: lone female
  if (femaleCount === 1) {
    return {
      required: true,
      reordered: false,
      reason: maleCount === 0
        ? 'Single female passenger travelling alone with driver'
        : 'Only one female in the ride — she will be alone with the driver during first pickup and last drop',
    };
  }

  // Case B: all female
  if (maleCount === 0) {
    return {
      required: true,
      reordered: false,
      reason: 'All passengers are female — no male buffer available',
    };
  }

  // Case C: restricted window
  if (inRestrictedWindow(rideTime)) {
    const canReorderSolveIt = femaleCount <= maleCount;
    if (!canReorderSolveIt) {
      return {
        required: true,
        reordered: false,
        reason: `Night/early window (before 07:00 or after 19:00) — ${femaleCount} female(s), ${maleCount} male(s); cannot avoid lone female at route ends`,
      };
    }
    return { required: false, reordered: true };
  }

  return { required: false, reordered: femaleCount > 0 };
}
