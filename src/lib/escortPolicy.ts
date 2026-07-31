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
  // If no ride time has been set by the supervisor, we cannot determine the
  // window — do NOT assume the current time. Return false so the window rule
  // is skipped until the supervisor actually picks a time.
  if (!rideTime) return false;
  const h = rideTime.getHours() + rideTime.getMinutes() / 60;
  return h < ESCORT_WINDOW_START_HOUR || h >= ESCORT_WINDOW_END_HOUR;
}

export function evaluateEscortPolicy(
  passengers: EscortPassenger[],
  rideTime: Date | null,
  rideType: string = 'login',
): EscortPolicyResult {
  if (!passengers.length) return { required: false, reordered: false };

  const femaleCount = passengers.filter((p) => isFemale(p.gender)).length;
  const maleCount   = passengers.length - femaleCount;

  if (femaleCount === 0) return { required: false, reordered: false };

  const isLogout = rideType === 'logout';

  // ── LOGOUT: everyone boards at the office together ─────────────────────────
  // No "first pickup alone" problem. Risk is only at individual drop-offs.
  if (isLogout) {
    // Case B: all female
    if (maleCount === 0) {
      return { required: true, reordered: false, reason: 'All passengers are female — no male buffer available' };
    }
    // Case A: lone female → will be last drop, alone with driver
    if (femaleCount === 1) {
      return {
        required: true,
        reordered: false,
        reason: 'Only one female in the ride — she will be alone with the driver at the last drop-off',
      };
    }
    // Night window + more females than males → a female must be at last drop
    if (inRestrictedWindow(rideTime) && femaleCount > maleCount) {
      return {
        required: true,
        reordered: false,
        reason: `Night window — ${femaleCount} female(s) but only ${maleCount} male(s); a female will be at the last drop-off`,
      };
    }
    return { required: false, reordered: femaleCount > 0 && maleCount > 0 };
  }

  // ── LOGIN: individual pickups — only seq=0 is an isolation risk ────────────
  // After seq=0 boards, every subsequent passenger boards into an occupied cab.
  // So the only true isolation scenario is: no male available to be seq=0.

  // Case A: lone female (total = 1) — she IS seq=0, alone with driver entire ride
  if (femaleCount === 1 && maleCount === 0) {
    return { required: true, reordered: false, reason: 'Single female passenger travelling alone with driver' };
  }

  // Case B: all female — no male can take seq=0
  if (maleCount === 0) {
    return { required: true, reordered: false, reason: 'All passengers are female — no male buffer available' };
  }

  // When there is at least 1 male, he takes seq=0 → females board into an
  // occupied cab. Reorder solves it — no escort needed during daytime.
  // Night/early window: still safe as long as a male is seq=0.
  // The only case we can't fix: femaleCount > 0 && maleCount === 0 (already handled above).
  if (inRestrictedWindow(rideTime) && maleCount === 0) {
    return {
      required: true,
      reordered: false,
      reason: 'Night/early window — no male passenger to occupy first pickup position',
    };
  }

  // At least 1 male exists → reorder puts him first → no escort needed
  return { required: false, reordered: femaleCount > 0 };
}
